import { ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createInventoryLevelsWorkflow,
} from "@medusajs/medusa/core-flows";

const SIZES = ["S", "M", "L", "XL"];
const COLORS = ["Black", "Broken White", "Beige"];

const COLOR_CODES: Record<string, string> = {
  Black: "BLK",
  "Broken White": "BWHT",
  Beige: "BEI",
};

export default async function seedFashionCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const productModule = container.resolve(Modules.PRODUCT);

  logger.info("--- Starting Fashion Catalog Seeding ---");

  // 1. Fetch prerequisite records
  const { data: salesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  });
  const { data: shippingProfiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "name"],
  });
  const { data: stockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  });

  const salesChannel = salesChannels[0];
  const shippingProfile = shippingProfiles[0];
  const stockLocation = stockLocations[0];

  if (!salesChannel || !shippingProfile || !stockLocation) {
    throw new Error(
      "Missing sales channel, shipping profile, or stock location. Please run initial setup first."
    );
  }

  // 2. Ensure Categories: Men, Women, Accessories
  const targetCategories = [
    { name: "Men", handle: "men", is_active: true },
    { name: "Women", handle: "women", is_active: true },
    { name: "Accessories", handle: "accessories", is_active: true },
  ];

  const { data: existingCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle"],
  });

  const missingCategories = targetCategories.filter(
    (tc) =>
      !existingCategories.some(
        (ec) => ec.name.toLowerCase() === tc.name.toLowerCase()
      )
  );

  if (missingCategories.length > 0) {
    logger.info(`Creating ${missingCategories.length} missing categories: ${missingCategories.map((c) => c.name).join(", ")}`);
    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: missingCategories,
      },
    });
  } else {
    logger.info("All target categories (Men, Women, Accessories) already exist.");
  }

  const { data: allCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle"],
  });
  const menCategory = allCategories.find(
    (c) => c.name.toLowerCase() === "men"
  );

  // 3. Prepare product & variants: "Oversized Heavyweight T-Shirt"
  const productHandle = "oversized-heavyweight-t-shirt";

  // If already exists, delete it for a clean re-seed
  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
    filters: { handle: productHandle },
  });

  if (existingProducts.length > 0) {
    logger.info(`Product '${productHandle}' already exists. Re-seeding cleanly...`);
    await productModule.deleteProducts(existingProducts.map((p) => p.id));
  }

  // Generate 12 combinations (4 sizes x 3 colors)
  const variants: any[] = [];
  for (const color of COLORS) {
    const colorCode = COLOR_CODES[color] || color.substring(0, 3).toUpperCase();
    for (const size of SIZES) {
      const sku = `TSHIRT-${colorCode}-${size}`;
      variants.push({
        title: `${size} / ${color}`,
        sku,
        options: {
          Size: size,
          Color: color,
        },
        prices: [
          {
            amount: 189000,
            currency_code: "idr",
          },
        ],
        manage_inventory: true,
      });
    }
  }

  logger.info(`Creating product 'Oversized Heavyweight T-Shirt' with ${variants.length} variants...`);

  const { result: createdProducts } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Oversized Heavyweight T-Shirt",
          handle: productHandle,
          subtitle: "Streetwear Essential Heavyweight Tee",
          description:
            "Kaos polos oversized heavyweight berbahan katun 100% dengan potongan boxy fit modern, bahu jatuh (drop shoulder), dan kerah tebal berkualitas tinggi.",
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          sales_channels: [{ id: salesChannel.id }],
          category_ids: menCategory ? [menCategory.id] : [],
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-front.png",
            },
          ],
          thumbnail:
            "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-front.png",
          options: [
            {
              title: "Size",
              values: SIZES,
            },
            {
              title: "Color",
              values: COLORS,
            },
          ],
          variants,
        },
      ],
    },
  });

  const createdProduct = createdProducts[0];
  logger.info(`Product created successfully: ${createdProduct.title} (${createdProduct.id})`);

  // 4. Set inventory levels: 20 pcs per variant
  const skus = variants.map((v) => v.sku);
  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
    filters: {
      sku: skus,
    },
  });

  logger.info(`Found ${inventoryItems.length} inventory items linked to variants.`);

  if (inventoryItems.length > 0) {
    // Check if any inventory levels already exist for these items
    const { data: existingLevels } = await query.graph({
      entity: "inventory_level",
      fields: ["id", "inventory_item_id", "location_id"],
      filters: {
        inventory_item_id: inventoryItems.map((item) => item.id),
        location_id: stockLocation.id,
      },
    });

    const itemsWithoutLevel = inventoryItems.filter(
      (item) => !existingLevels.some((el) => el.inventory_item_id === item.id)
    );

    if (itemsWithoutLevel.length > 0) {
      await createInventoryLevelsWorkflow(container).run({
        input: {
          inventory_levels: itemsWithoutLevel.map((item) => ({
            location_id: stockLocation.id,
            stocked_quantity: 20,
            inventory_item_id: item.id,
          })),
        },
      });
      logger.info(
        `Set stock level to 20 pcs for ${itemsWithoutLevel.length} variants at '${stockLocation.name}'.`
      );
    }
  }

  // 5. Ingest into search index if available
  try {
    const search = container.resolve(Modules.SEARCH);
    if (search && typeof search.ingest === "function") {
      await search.ingest({
        name: "product.created",
        data: [{ id: createdProduct.id }],
      } as never);
      logger.info("Search index updated.");
    }
  } catch (err) {
    logger.warn("Search index update skipped or not enabled.");
  }

  logger.info("--- Fashion Catalog Seeding Completed Successfully! ---");
}
