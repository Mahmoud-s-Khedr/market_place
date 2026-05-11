export const PRODUCT_SUBCATEGORIES = [
  'all',
  'apartmentForRent',
  'apartmentForSale',
  'houses',
  'lands',
  'commercialRealEstateForRent',
  'commercialRealEstateForSale',
  'other',
  'carsForSale',
  'carsForRent',
  'sparePartsAndAccessories',
  'motorCycles',
  'bicycles',
  'trucksAndHeavyVehicles',
  'smartphones',
  'tablets',
  'laptopsAndComputers',
  'accessories',
  'speakersAndHeadphones',
  'cameras',
  'smartWatchesAndWearables',
  'monitorsAndTVs',
  'furniture',
  'officeFurniture',
  'kitchenAndDining',
  'beddingAndBath',
  'homeDecor',
  'homeTools',
  'lighting',
  'menClothing',
  'womenClothing',
  'kidsClothing',
  'shoes',
  'menAccessories',
  'womenAccessoriesAndMakeup',
  'jewelryAndWatches',
  'maintenanceAndRepairs',
  'transportationAndMoving',
  'personalServices',
  'carsServices',
  'homeServices',
  'lessonsAndTutoring',
] as const;

export type ProductSubCategory = typeof PRODUCT_SUBCATEGORIES[number];

export const PRODUCT_CATEGORIES = [
  'realEstate',
  'vehicles',
  'electronics',
  'homeAndDecor',
  'clothingAndFashion',
  'services',
] as const;

export type ProductCategory = typeof PRODUCT_CATEGORIES[number];

export const CATEGORY_TO_SUBCATEGORIES: Record<ProductCategory, readonly ProductSubCategory[]> = {
  realEstate: [
    'all',
    'apartmentForRent',
    'apartmentForSale',
    'houses',
    'lands',
    'commercialRealEstateForRent',
    'commercialRealEstateForSale',
    'other',
  ],
  vehicles: [
    'all',
    'carsForSale',
    'carsForRent',
    'sparePartsAndAccessories',
    'motorCycles',
    'bicycles',
    'trucksAndHeavyVehicles',
  ],
  electronics: [
    'all',
    'smartphones',
    'tablets',
    'laptopsAndComputers',
    'accessories',
    'speakersAndHeadphones',
    'cameras',
    'smartWatchesAndWearables',
    'monitorsAndTVs',
    'other',
  ],
  homeAndDecor: [
    'all',
    'furniture',
    'officeFurniture',
    'kitchenAndDining',
    'beddingAndBath',
    'homeDecor',
    'homeTools',
    'lighting',
    'other',
  ],
  clothingAndFashion: [
    'all',
    'menClothing',
    'womenClothing',
    'kidsClothing',
    'shoes',
    'menAccessories',
    'womenAccessoriesAndMakeup',
    'jewelryAndWatches',
    'other',
  ],
  services: [
    'all',
    'maintenanceAndRepairs',
    'transportationAndMoving',
    'personalServices',
    'carsServices',
    'homeServices',
    'lessonsAndTutoring',
    'other',
  ],
};

export function isValidCategory(category: string): category is ProductCategory {
  return PRODUCT_CATEGORIES.includes(category as ProductCategory);
}

export function isValidSubcategory(category: string, subcategory: string): boolean {
  if (!isValidCategory(category)) return false;
  return CATEGORY_TO_SUBCATEGORIES[category].includes(subcategory as ProductSubCategory);
}

export function isAllowedProductSubcategory(category: string, subcategory: string): boolean {
  return isValidSubcategory(category, subcategory) && subcategory !== 'all';
}

export function getAllowedSubcategories(category: string): readonly ProductSubCategory[] {
  if (!isValidCategory(category)) return [];
  return CATEGORY_TO_SUBCATEGORIES[category];
}
