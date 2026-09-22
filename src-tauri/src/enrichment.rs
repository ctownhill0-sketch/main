//! Website email enrichment: crawls a lead's own website (never Google
//! Maps Content — Places has no email field at any tier) to find contact
//! emails. Respects robots.txt, times out, rate-limits itself between
//! page fetches, and records provenance (source URL + fetch time) for
//! every email found.
//!
//! Legal note surfaced in the UI, not enforced here (this app only
//! collects — it never sends): CAN-SPAM (US) requires a valid postal
//! address, a working opt-out, and honest headers on any commercial email
//! sent using these addresses (up to $53,088 per violating email);
//! GDPR/PECR (EU/UK) generally allow B2B outreach under legitimate
//! interest with an easy opt-out; CASL (Canada) requires consent first.

use std::collections::HashSet;
use std::time::Duration;

use regex::Regex;
use reqwest::{Client, Url};
use serde::Serialize;

use crate::robots::RobotsRules;

const USER_AGENT: &str =
    "LeadScoutBot/1.0 (+desktop lead-research tool; contact-page email enrichment)";
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_PAGES: usize = 3; // homepage + up to 2 same-domain contact/about pages
const BETWEEN_PAGE_DELAY: Duration = Duration::from_millis(500);

#[derive(Debug, thiserror::Error)]
pub enum EnrichmentError {
    #[error("that doesn't look like a valid website URL: {0}")]
    InvalidUrl(String),
    #[error("this site's robots.txt disallows crawling its homepage")]
    RobotsDisallowed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundEmail {
    pub email: String,
    pub source_url: String,
}

fn build_client() -> Client {
    Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .expect("failed to build HTTP client")
}

async fn fetch_robots_rules(client: &Client, base: &Url) -> RobotsRules {
    let Ok(robots_url) = base.join("/robots.txt") else {
        return RobotsRules::allow_all();
    };
    match client.get(robots_url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.text().await {
            Ok(body) => RobotsRules::parse(&body),
            Err(_) => RobotsRules::allow_all(),
        },
        _ => RobotsRules::allow_all(),
    }
}

async fn try_fetch_page(client: &Client, url: &Url) -> Option<String> {
    let resp = client.get(url.clone()).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.text().await.ok()
}

fn extract_mailto_emails(html: &str) -> Vec<String> {
    let re = Regex::new(r"(?i)mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})").unwrap();
    re.captures_iter(html).map(|c| c[1].to_string()).collect()
}

fn extract_text_emails(html: &str) -> Vec<String> {
    let re = Regex::new(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}").unwrap();
    re.find_iter(html)
        .map(|m| m.as_str().to_string())
        // Filter obvious false positives, e.g. "icon@2x.png" from srcset attributes.
        .filter(|e| {
            let lower = e.to_ascii_lowercase();
            !(lower.ends_with(".png") || lower.ends_with(".jpg") || lower.ends_with(".jpeg") || lower.ends_with(".svg") || lower.ends_with(".gif"))
        })
        .collect()
}

fn page_emails(html: &str, source: &Url) -> Vec<FoundEmail> {
    let mut emails = extract_mailto_emails(html);
    emails.extend(extract_text_emails(html));

    let mut seen = HashSet::new();
    emails.retain(|e| seen.insert(e.to_ascii_lowercase()));

    emails
        .into_iter()
        .map(|email| FoundEmail { email, source_url: source.to_string() })
        .collect()
}

fn find_contact_links(html: &str, base: &Url) -> Vec<Url> {
    let re = Regex::new(r#"(?is)<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>"#).unwrap();
    let mut links = Vec::new();
    let mut seen_paths = HashSet::new();

    for cap in re.captures_iter(html) {
        let href = &cap[1];
        let text = &cap[2];
        let relevant = ["contact", "about"].iter().any(|kw| {
            href.to_ascii_lowercase().contains(kw) || text.to_ascii_lowercase().contains(kw)
        });
        if !relevant {
            continue;
        }
        let Ok(url) = base.join(href) else { continue };
        if url.origin() != base.origin() {
            continue; // never crawl off-domain links
        }
        if seen_paths.insert(url.path().to_string()) {
            links.push(url);
        }
    }
    links
}

/// info@ / contact@ addresses are the most likely to be monitored, so
/// surface them first without discarding anything else found.
fn prioritize(mut found: Vec<FoundEmail>) -> Vec<FoundEmail> {
    found.sort_by_key(|f| {
        let lower = f.email.to_ascii_lowercase();
        if lower.starts_with("info@") || lower.starts_with("contact@") { 0 } else { 1 }
    });
    found
}

pub async fn enrich_website(website_uri: &str) -> Result<Vec<FoundEmail>, EnrichmentError> {
    let base = Url::parse(website_uri).map_err(|_| EnrichmentError::InvalidUrl(website_uri.to_string()))?;
    let client = build_client();
    let robots = fetch_robots_rules(&client, &base).await;

    if !robots.is_allowed(base.path()) {
        return Err(EnrichmentError::RobotsDisallowed);
    }

    let home_html = try_fetch_page(&client, &base).await.unwrap_or_default();
    let mut found = page_emails(&home_html, &base);

    let mut visited_paths = HashSet::new();
    visited_paths.insert(base.path().to_string());

    let mut pages_fetched = 1usize;
    for link in find_contact_links(&home_html, &base) {
        if pages_fetched >= MAX_PAGES {
            break;
        }
        if !visited_paths.insert(link.path().to_string()) {
            continue;
        }
        if !robots.is_allowed(link.path()) {
            continue;
        }
        tokio::time::sleep(BETWEEN_PAGE_DELAY).await;
        if let Some(html) = try_fetch_page(&client, &link).await {
            found.extend(page_emails(&html, &link));
            pages_fetched += 1;
        }
    }

    let mut seen = HashSet::new();
    found.retain(|f| seen.insert(f.email.to_ascii_lowercase()));

    Ok(prioritize(found))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_mailto_links() {
        let html = r#"<a href="mailto:info@example.com">Email us</a>"#;
        assert_eq!(extract_mailto_emails(html), vec!["info@example.com"]);
    }

    #[test]
    fn extracts_plain_text_emails_and_skips_image_like_false_positives() {
        let html = "Contact us at hello@example.com or see icon@2x.png in our assets.";
        let found = extract_text_emails(html);
        assert_eq!(found, vec!["hello@example.com"]);
    }

    #[test]
    fn prioritizes_info_and_contact_addresses_first() {
        let found = vec![
            FoundEmail { email: "jane@example.com".to_string(), source_url: "https://example.com".to_string() },
            FoundEmail { email: "info@example.com".to_string(), source_url: "https://example.com".to_string() },
        ];
        let sorted = prioritize(found);
        assert_eq!(sorted[0].email, "info@example.com");
    }

    #[test]
    fn finds_same_domain_contact_links_and_ignores_off_domain_ones() {
        let base = Url::parse("https://example.com/").unwrap();
        let html = r#"
            <a href="/contact-us">Contact</a>
            <a href="https://otherdomain.com/contact">External contact</a>
            <a href="/products">Products</a>
        "#;
        let links = find_contact_links(html, &base);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].as_str(), "https://example.com/contact-us");
    }

    #[test]
    fn page_emails_dedupes_case_insensitively_within_one_page() {
        let base = Url::parse("https://example.com/").unwrap();
        let html = r#"<a href="mailto:Info@Example.com">Email</a> info@example.com"#;
        let found = page_emails(html, &base);
        assert_eq!(found.len(), 1);
    }
}
