/**
 * Hand-mirrors src-tauri/src/places/types.rs's ALL_PLACE_TYPES — keep the two
 * in sync by hand (same convention as cost.ts mirroring cost.rs). See that
 * file's doc comment for the "compiled from trained knowledge, not
 * live-fetched" disclaimer and why this is a curated subset, not the full
 * Google Places type catalog.
 */
export interface PlaceTypeDef {
  value: string;
  label: string;
  group: string;
}

export const ALL_PLACE_TYPES: PlaceTypeDef[] = [
  // Home Services
  { value: "general_contractor", label: "General Contractor", group: "Home Services" },
  { value: "roofing_contractor", label: "Roofing Contractor", group: "Home Services" },
  { value: "electrician", label: "Electrician", group: "Home Services" },
  { value: "plumber", label: "Plumber", group: "Home Services" },
  { value: "hvac_contractor", label: "HVAC Contractor", group: "Home Services" },
  { value: "painter", label: "Painter", group: "Home Services" },
  { value: "locksmith", label: "Locksmith", group: "Home Services" },
  { value: "moving_company", label: "Moving Company", group: "Home Services" },
  // Food & Drink
  { value: "restaurant", label: "Restaurant", group: "Food & Drink" },
  { value: "cafe", label: "Cafe", group: "Food & Drink" },
  { value: "bar", label: "Bar", group: "Food & Drink" },
  { value: "bakery", label: "Bakery", group: "Food & Drink" },
  { value: "coffee_shop", label: "Coffee Shop", group: "Food & Drink" },
  { value: "fast_food_restaurant", label: "Fast Food Restaurant", group: "Food & Drink" },
  { value: "pizza_restaurant", label: "Pizza Restaurant", group: "Food & Drink" },
  { value: "meal_delivery", label: "Meal Delivery", group: "Food & Drink" },
  { value: "meal_takeaway", label: "Meal Takeaway", group: "Food & Drink" },
  // Health
  { value: "dentist", label: "Dentist", group: "Health" },
  { value: "doctor", label: "Doctor", group: "Health" },
  { value: "physiotherapist", label: "Physiotherapist", group: "Health" },
  { value: "chiropractor", label: "Chiropractor", group: "Health" },
  { value: "veterinary_care", label: "Veterinary Care", group: "Health" },
  { value: "hospital", label: "Hospital", group: "Health" },
  { value: "pharmacy", label: "Pharmacy", group: "Health" },
  // Automotive
  { value: "car_dealer", label: "Car Dealer", group: "Automotive" },
  { value: "car_rental", label: "Car Rental", group: "Automotive" },
  { value: "car_repair", label: "Car Repair", group: "Automotive" },
  { value: "car_wash", label: "Car Wash", group: "Automotive" },
  { value: "gas_station", label: "Gas Station", group: "Automotive" },
  { value: "electric_vehicle_charging_station", label: "EV Charging Station", group: "Automotive" },
  { value: "parking", label: "Parking", group: "Automotive" },
  // Professional Services
  { value: "lawyer", label: "Lawyer", group: "Professional Services" },
  { value: "accounting", label: "Accounting", group: "Professional Services" },
  { value: "real_estate_agency", label: "Real Estate Agency", group: "Professional Services" },
  { value: "insurance_agency", label: "Insurance Agency", group: "Professional Services" },
  // Retail
  { value: "clothing_store", label: "Clothing Store", group: "Retail" },
  { value: "shoe_store", label: "Shoe Store", group: "Retail" },
  { value: "jewelry_store", label: "Jewelry Store", group: "Retail" },
  { value: "furniture_store", label: "Furniture Store", group: "Retail" },
  { value: "hardware_store", label: "Hardware Store", group: "Retail" },
  { value: "home_goods_store", label: "Home Goods Store", group: "Retail" },
  { value: "electronics_store", label: "Electronics Store", group: "Retail" },
  { value: "florist", label: "Florist", group: "Retail" },
  { value: "book_store", label: "Book Store", group: "Retail" },
  { value: "pet_store", label: "Pet Store", group: "Retail" },
  // Personal Care
  { value: "gym", label: "Gym", group: "Personal Care" },
  { value: "beauty_salon", label: "Beauty Salon", group: "Personal Care" },
  { value: "hair_care", label: "Hair Care", group: "Personal Care" },
  { value: "spa", label: "Spa", group: "Personal Care" },
];

export const PLACE_TYPE_GROUPS: string[] = Array.from(
  new Set(ALL_PLACE_TYPES.map((t) => t.group)),
);

export function placeTypesByGroup(): Map<string, PlaceTypeDef[]> {
  const map = new Map<string, PlaceTypeDef[]>();
  for (const t of ALL_PLACE_TYPES) {
    const list = map.get(t.group) ?? [];
    list.push(t);
    map.set(t.group, list);
  }
  return map;
}
