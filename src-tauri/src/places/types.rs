//! A curated subset of Google Places API (New) `includedType` values, for
//! the frontend's business-type combobox and presets.
//!
//! Compiled from trained knowledge, not live-fetched — `developers.google.com`
//! is blocked by this sandbox's network egress policy (confirmed via a direct
//! fetch attempt). Spot-check these strings against the live reference
//! (https://developers.google.com/maps/documentation/places/web-service/place-types)
//! before relying on this list for a real campaign — same "verify before
//! relying on it for real spend decisions" caveat CLAUDE.md already carries
//! for the pricing table, just applied to a type catalog instead of prices.
//!
//! This is deliberately a curated ~50-type subset of Google's full ~180-entry
//! catalog — the types with the highest lead-gen relevance across 7 groups —
//! not an exhaustive mirror. A wrong or renamed type string here fails safe:
//! Google's API rejects an invalid `includedType` with a loud 400 error
//! (surfaced through the existing error-toast path), never a silent bad
//! result or silent overbilling.

pub struct PlaceTypeDef {
    pub value: &'static str,
    pub label: &'static str,
    pub group: &'static str,
}

macro_rules! place_type {
    ($value:expr, $label:expr, $group:expr) => {
        PlaceTypeDef { value: $value, label: $label, group: $group }
    };
}

pub const ALL_PLACE_TYPES: &[PlaceTypeDef] = &[
    // Home Services
    place_type!("general_contractor", "General Contractor", "Home Services"),
    place_type!("roofing_contractor", "Roofing Contractor", "Home Services"),
    place_type!("electrician", "Electrician", "Home Services"),
    place_type!("plumber", "Plumber", "Home Services"),
    place_type!("hvac_contractor", "HVAC Contractor", "Home Services"),
    place_type!("painter", "Painter", "Home Services"),
    place_type!("locksmith", "Locksmith", "Home Services"),
    place_type!("moving_company", "Moving Company", "Home Services"),
    // Food & Drink
    place_type!("restaurant", "Restaurant", "Food & Drink"),
    place_type!("cafe", "Cafe", "Food & Drink"),
    place_type!("bar", "Bar", "Food & Drink"),
    place_type!("bakery", "Bakery", "Food & Drink"),
    place_type!("coffee_shop", "Coffee Shop", "Food & Drink"),
    place_type!("fast_food_restaurant", "Fast Food Restaurant", "Food & Drink"),
    place_type!("pizza_restaurant", "Pizza Restaurant", "Food & Drink"),
    place_type!("meal_delivery", "Meal Delivery", "Food & Drink"),
    place_type!("meal_takeaway", "Meal Takeaway", "Food & Drink"),
    // Health
    place_type!("dentist", "Dentist", "Health"),
    place_type!("doctor", "Doctor", "Health"),
    place_type!("physiotherapist", "Physiotherapist", "Health"),
    place_type!("chiropractor", "Chiropractor", "Health"),
    place_type!("veterinary_care", "Veterinary Care", "Health"),
    place_type!("hospital", "Hospital", "Health"),
    place_type!("pharmacy", "Pharmacy", "Health"),
    // Automotive
    place_type!("car_dealer", "Car Dealer", "Automotive"),
    place_type!("car_rental", "Car Rental", "Automotive"),
    place_type!("car_repair", "Car Repair", "Automotive"),
    place_type!("car_wash", "Car Wash", "Automotive"),
    place_type!("gas_station", "Gas Station", "Automotive"),
    place_type!("electric_vehicle_charging_station", "EV Charging Station", "Automotive"),
    place_type!("parking", "Parking", "Automotive"),
    // Professional Services
    place_type!("lawyer", "Lawyer", "Professional Services"),
    place_type!("accounting", "Accounting", "Professional Services"),
    place_type!("real_estate_agency", "Real Estate Agency", "Professional Services"),
    place_type!("insurance_agency", "Insurance Agency", "Professional Services"),
    // Retail
    place_type!("clothing_store", "Clothing Store", "Retail"),
    place_type!("shoe_store", "Shoe Store", "Retail"),
    place_type!("jewelry_store", "Jewelry Store", "Retail"),
    place_type!("furniture_store", "Furniture Store", "Retail"),
    place_type!("hardware_store", "Hardware Store", "Retail"),
    place_type!("home_goods_store", "Home Goods Store", "Retail"),
    place_type!("electronics_store", "Electronics Store", "Retail"),
    place_type!("florist", "Florist", "Retail"),
    place_type!("book_store", "Book Store", "Retail"),
    place_type!("pet_store", "Pet Store", "Retail"),
    // Personal Care
    place_type!("gym", "Gym", "Personal Care"),
    place_type!("beauty_salon", "Beauty Salon", "Personal Care"),
    place_type!("hair_care", "Hair Care", "Personal Care"),
    place_type!("spa", "Spa", "Personal Care"),
];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn every_type_value_is_unique() {
        let mut seen = HashSet::new();
        for t in ALL_PLACE_TYPES {
            assert!(seen.insert(t.value), "duplicate place type value: {}", t.value);
        }
    }

    #[test]
    fn no_group_or_label_is_empty() {
        for t in ALL_PLACE_TYPES {
            assert!(!t.group.is_empty(), "type {} has an empty group", t.value);
            assert!(!t.label.is_empty(), "type {} has an empty label", t.value);
        }
    }
}
