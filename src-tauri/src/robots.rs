//! Minimal robots.txt parser — just enough to respect the wildcard
//! (`User-agent: *`) group's Disallow/Allow rules, which is what "respect
//! robots.txt" means for a generic crawler that doesn't ask for a special
//! per-site exception. A missing or unfetchable robots.txt is treated as
//! "allow everything", the standard convention.

pub struct RobotsRules {
    disallow: Vec<String>,
    allow: Vec<String>,
}

impl RobotsRules {
    pub fn allow_all() -> Self {
        Self { disallow: Vec::new(), allow: Vec::new() }
    }

    pub fn parse(body: &str) -> Self {
        let mut disallow = Vec::new();
        let mut allow = Vec::new();
        let mut in_wildcard_group = false;

        for raw_line in body.lines() {
            let line = raw_line.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            let Some((key, value)) = line.split_once(':') else { continue };
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim().to_string();

            match key.as_str() {
                "user-agent" => in_wildcard_group = value == "*",
                "disallow" if in_wildcard_group && !value.is_empty() => disallow.push(value),
                "allow" if in_wildcard_group && !value.is_empty() => allow.push(value),
                _ => {}
            }
        }

        Self { disallow, allow }
    }

    /// Standard robots.txt precedence: the longest matching prefix rule
    /// wins; no match at all means allowed.
    pub fn is_allowed(&self, path: &str) -> bool {
        let mut best: Option<(usize, bool)> = None;

        for rule in &self.disallow {
            if path.starts_with(rule.as_str()) {
                let len = rule.len();
                if best.is_none_or(|(l, _)| len > l) {
                    best = Some((len, false));
                }
            }
        }
        for rule in &self.allow {
            if path.starts_with(rule.as_str()) {
                let len = rule.len();
                if best.is_none_or(|(l, _)| len > l) {
                    best = Some((len, true));
                }
            }
        }

        best.map(|(_, allowed)| allowed).unwrap_or(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_robots_txt_allows_everything() {
        let rules = RobotsRules::parse("");
        assert!(rules.is_allowed("/anything"));
    }

    #[test]
    fn disallow_all_blocks_every_path() {
        let rules = RobotsRules::parse("User-agent: *\nDisallow: /");
        assert!(!rules.is_allowed("/"));
        assert!(!rules.is_allowed("/contact"));
    }

    #[test]
    fn specific_disallow_only_blocks_matching_prefix() {
        let rules = RobotsRules::parse("User-agent: *\nDisallow: /private");
        assert!(!rules.is_allowed("/private/data"));
        assert!(rules.is_allowed("/contact"));
        assert!(rules.is_allowed("/"));
    }

    #[test]
    fn a_more_specific_allow_overrides_a_broader_disallow() {
        let rules = RobotsRules::parse("User-agent: *\nDisallow: /\nAllow: /contact");
        assert!(!rules.is_allowed("/private"));
        assert!(rules.is_allowed("/contact"));
        assert!(rules.is_allowed("/contact/us"));
    }

    #[test]
    fn rules_under_a_specific_bot_group_are_ignored_only_wildcard_group_applies() {
        let rules = RobotsRules::parse("User-agent: GoogleBot\nDisallow: /\nUser-agent: *\nAllow: /");
        assert!(rules.is_allowed("/anything"), "only the '*' group should be honored");
    }

    #[test]
    fn comments_and_blank_lines_are_ignored() {
        let rules = RobotsRules::parse("# comment\n\nUser-agent: *\nDisallow: /admin # trailing comment\n");
        assert!(!rules.is_allowed("/admin"));
        assert!(rules.is_allowed("/home"));
    }
}
