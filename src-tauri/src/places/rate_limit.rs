//! Token-bucket rate limiter and exponential backoff for Places API calls.
//!
//! Google publishes no fixed numeric default rate limit for these APIs
//! (quota is per-method-per-project, adjustable in Cloud Console), so we
//! throttle conservatively client-side: a configurable QPS (default low)
//! plus exponential backoff on 429 / RESOURCE_EXHAUSTED.

use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::Instant;

const DEFAULT_QPS: f64 = 5.0;

struct BucketState {
    tokens: f64,
    last_refill: Instant,
}

pub struct RateLimiter {
    capacity: f64,
    refill_per_sec: f64,
    state: Mutex<BucketState>,
}

impl RateLimiter {
    pub fn new(qps: f64) -> Self {
        let qps = if qps > 0.0 { qps } else { DEFAULT_QPS };
        Self {
            capacity: qps.max(1.0),
            refill_per_sec: qps,
            state: Mutex::new(BucketState {
                tokens: qps.max(1.0),
                last_refill: Instant::now(),
            }),
        }
    }

    /// Blocks (async) until a token is available, then consumes it.
    pub async fn acquire(&self) {
        loop {
            let wait = {
                let mut state = self.state.lock().await;
                let now = Instant::now();
                let elapsed = now.duration_since(state.last_refill).as_secs_f64();
                state.tokens = (state.tokens + elapsed * self.refill_per_sec).min(self.capacity);
                state.last_refill = now;

                if state.tokens >= 1.0 {
                    state.tokens -= 1.0;
                    None
                } else {
                    let deficit = 1.0 - state.tokens;
                    Some(Duration::from_secs_f64(deficit / self.refill_per_sec))
                }
            };

            match wait {
                None => return,
                Some(d) => tokio::time::sleep(d).await,
            }
        }
    }
}

/// Exponential backoff for 429 / RESOURCE_EXHAUSTED responses.
pub struct Backoff {
    attempt: u32,
    base_ms: u64,
    max_ms: u64,
}

impl Backoff {
    pub fn new() -> Self {
        Self {
            attempt: 0,
            base_ms: 500,
            max_ms: 30_000,
        }
    }

    pub fn attempts(&self) -> u32 {
        self.attempt
    }

    pub fn next_delay(&mut self) -> Duration {
        let delay_ms = self
            .base_ms
            .saturating_mul(1u64 << self.attempt.min(20))
            .min(self.max_ms);
        self.attempt += 1;
        Duration::from_millis(delay_ms)
    }
}

impl Default for Backoff {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_each_attempt_up_to_the_cap() {
        let mut b = Backoff::new();
        assert_eq!(b.next_delay(), Duration::from_millis(500));
        assert_eq!(b.next_delay(), Duration::from_millis(1000));
        assert_eq!(b.next_delay(), Duration::from_millis(2000));
        assert_eq!(b.next_delay(), Duration::from_millis(4000));
    }

    #[test]
    fn backoff_never_exceeds_max_ms() {
        let mut b = Backoff::new();
        for _ in 0..20 {
            let d = b.next_delay();
            assert!(d <= Duration::from_millis(30_000));
        }
    }

    #[tokio::test(start_paused = true)]
    async fn rate_limiter_allows_a_burst_up_to_capacity_then_throttles() {
        let limiter = RateLimiter::new(2.0); // capacity 2, refills at 2/sec
        let start = Instant::now();

        // First two acquires consume the initial full bucket instantly.
        limiter.acquire().await;
        limiter.acquire().await;
        assert!(Instant::now().duration_since(start) < Duration::from_millis(50));

        // Third must wait ~500ms for a token to refill at 2/sec.
        limiter.acquire().await;
        let elapsed = Instant::now().duration_since(start);
        assert!(
            elapsed >= Duration::from_millis(400),
            "expected throttling to wait for refill, elapsed = {elapsed:?}"
        );
    }
}
