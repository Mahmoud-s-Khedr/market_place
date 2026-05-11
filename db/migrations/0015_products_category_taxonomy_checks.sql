-- Migration: enforce product category/subcategory taxonomy.

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_category_enum_check,
  DROP CONSTRAINT IF EXISTS products_subcategory_enum_check,
  DROP CONSTRAINT IF EXISTS products_subcategory_not_all_check;

ALTER TABLE products
  ADD CONSTRAINT products_category_enum_check
  CHECK (category IN (
    'realEstate',
    'vehicles',
    'electronics',
    'homeAndDecor',
    'clothingAndFashion',
    'services'
  ));

ALTER TABLE products
  ADD CONSTRAINT products_subcategory_enum_check
  CHECK (subcategory IS NULL OR subcategory IN (
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
    'lessonsAndTutoring'
  ));

ALTER TABLE products
  ADD CONSTRAINT products_subcategory_not_all_check
  CHECK (subcategory IS NULL OR subcategory <> 'all');
