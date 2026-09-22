//! The three hard-coded field masks. See CLAUDE.md — never add a field to
//! any of these without updating that doc's cost table, and never build a
//! mask string by hand anywhere else in the codebase.

use super::cost::Tier;

/// Text/Nearby Search, Pro tier ($32/1k). Used for all discovery (Quick
/// Search and Deep Search tiling) — never anything more expensive.
pub const MASK_DISCOVERY: &str = "places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus,places.primaryType,nextPageToken";

/// Place Details, Enterprise tier ($20/1k). Only ever requested for leads
/// the user has explicitly kept/selected — never in bulk over every
/// discovered place.
pub const MASK_DETAILS_ENTERPRISE: &str = "id,displayName,formattedAddress,location,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount,regularOpeningHours,businessStatus,googleMapsUri";

/// Place Details, Essentials tier (effectively free). Used only to
/// refresh/validate that a stored place ID is still current.
pub const MASK_ID_ONLY: &str = "id";

/// Fields that only exist at the Enterprise or Enterprise+Atmosphere tier.
/// `MASK_DETAILS_ENTERPRISE` is the only mask allowed to contain any of
/// these — see the guard test below.
const ENTERPRISE_OR_ATMOSPHERE_FIELDS: &[&str] = &[
    "nationalPhoneNumber",
    "internationalPhoneNumber",
    "websiteUri",
    "rating",
    "userRatingCount",
    "regularOpeningHours",
    "currentOpeningHours",
    "priceLevel",
    "priceRange",
    "reviews",
    "photos",
    "editorialSummary",
    "reservable",
    "servesBreakfast",
    "servesLunch",
    "servesDinner",
    "delivery",
    "dineIn",
    "takeout",
    "curbsidePickup",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlaceMask {
    Discovery,
    DetailsEnterprise,
    IdOnly,
}

impl PlaceMask {
    pub fn field_mask(&self) -> &'static str {
        match self {
            PlaceMask::Discovery => MASK_DISCOVERY,
            PlaceMask::DetailsEnterprise => MASK_DETAILS_ENTERPRISE,
            PlaceMask::IdOnly => MASK_ID_ONLY,
        }
    }

    pub fn name(&self) -> &'static str {
        match self {
            PlaceMask::Discovery => "MASK_DISCOVERY",
            PlaceMask::DetailsEnterprise => "MASK_DETAILS_ENTERPRISE",
            PlaceMask::IdOnly => "MASK_ID_ONLY",
        }
    }

    /// The billing tier this mask's fields fall into. Search masks are
    /// always at least Pro tier (Search has no Essentials tier); Details
    /// masks range from Essentials to Enterprise.
    pub fn tier(&self) -> Tier {
        match self {
            PlaceMask::Discovery => Tier::SearchPro,
            PlaceMask::DetailsEnterprise => Tier::DetailsEnterprise,
            PlaceMask::IdOnly => Tier::DetailsEssentials,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build-time guard (spec section 7): fails if any mask other than
    /// MASK_DETAILS_ENTERPRISE ever picks up an Enterprise/Atmosphere-tier
    /// field, which would silently move that call to a more expensive tier.
    #[test]
    fn only_details_enterprise_mask_may_contain_enterprise_or_atmosphere_fields() {
        for field in ENTERPRISE_OR_ATMOSPHERE_FIELDS {
            assert!(
                !MASK_DISCOVERY.contains(field),
                "MASK_DISCOVERY must not contain Enterprise/Atmosphere field `{field}`"
            );
            assert!(
                !MASK_ID_ONLY.contains(field),
                "MASK_ID_ONLY must not contain Enterprise/Atmosphere field `{field}`"
            );
        }
    }

    #[test]
    fn each_mask_reports_its_own_field_string_and_tier() {
        assert_eq!(PlaceMask::Discovery.field_mask(), MASK_DISCOVERY);
        assert_eq!(PlaceMask::Discovery.tier(), Tier::SearchPro);

        assert_eq!(PlaceMask::DetailsEnterprise.field_mask(), MASK_DETAILS_ENTERPRISE);
        assert_eq!(PlaceMask::DetailsEnterprise.tier(), Tier::DetailsEnterprise);

        assert_eq!(PlaceMask::IdOnly.field_mask(), MASK_ID_ONLY);
        assert_eq!(PlaceMask::IdOnly.tier(), Tier::DetailsEssentials);
    }
}
