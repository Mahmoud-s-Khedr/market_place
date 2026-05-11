import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import { isValidCategory, isValidSubcategory } from '../product-taxonomy';

export function IsValidProductCategory(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidProductCategory',
      target: (object as { constructor: new (...args: unknown[]) => unknown }).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isValidCategory(value);
        },
      },
    });
  };
}

export function IsValidSubcategoryForCategory(
  categoryField: string,
  opts: { allowAll: boolean },
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidSubcategoryForCategory',
      target: (object as { constructor: new (...args: unknown[]) => unknown }).constructor,
      propertyName,
      constraints: [categoryField, opts.allowAll],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value === undefined || value === null) return true;
          if (typeof value !== 'string') return false;
          const [relatedField, allowAll] = args.constraints as [string, boolean];
          const categoryValue = (args.object as Record<string, unknown>)[relatedField];
          if (typeof categoryValue !== 'string') return true;
          if (!isValidSubcategory(categoryValue, value)) return false;
          if (!allowAll && value === 'all') return false;
          return true;
        },
      },
    });
  };
}
