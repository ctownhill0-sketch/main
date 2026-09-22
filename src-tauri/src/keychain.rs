//! OS-keychain-backed storage for the user's Google Places API key.
//!
//! The key is never written to SQLite, localStorage, or any plaintext file.
//! On macOS this uses Keychain Services, on Windows the Credential Manager,
//! and on Linux the Secret Service (via the `keyring` crate's backends).

use keyring::Entry;

const SERVICE: &str = "com.leadscout.app";
const USERNAME: &str = "google-places-api-key";

#[derive(Debug, thiserror::Error)]
pub enum KeychainError {
    #[error("keychain access failed: {0}")]
    Backend(#[from] keyring::Error),
}

fn entry() -> Result<Entry, KeychainError> {
    Ok(Entry::new(SERVICE, USERNAME)?)
}

pub fn set_api_key(key: &str) -> Result<(), KeychainError> {
    entry()?.set_password(key)?;
    Ok(())
}

pub fn get_api_key() -> Result<Option<String>, KeychainError> {
    match entry()?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_api_key() -> Result<(), KeychainError> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
