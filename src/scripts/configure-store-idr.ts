import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  updateStoresWorkflow,
  createRegionsWorkflow,
  createTaxRegionsWorkflow,
} from "@medusajs/medusa/core-flows"

export default async function configureStoreIdr({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const storeModule = container.resolve(Modules.STORE)
  const [store] = await storeModule.listStores()

  logger.info(`Updating store ${store.id} currencies...`)

  // Create Indonesia region with IDR
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "Indonesia",
          currency_code: "idr",
          countries: ["id"],
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  })
  const indonesiaRegion = regionResult[0]
  logger.info(`Created region: ${indonesiaRegion.name} (${indonesiaRegion.id})`)

  try {
    await createTaxRegionsWorkflow(container).run({
      input: [
        {
          country_code: "id",
          provider_id: "tp_system",
        },
      ],
    })
    logger.info("Created tax region for Indonesia.")
  } catch (err) {
    logger.warn("Tax region creation skipped or already exists.")
  }

  // Update store with IDR as default currency and Indonesia as default region
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        supported_currencies: [
          {
            currency_code: "idr",
            is_default: true,
          },
          {
            currency_code: "usd",
            is_default: false,
          },
        ],
        default_region_id: indonesiaRegion.id,
      },
    },
  })

  logger.info("Store default currency successfully updated to IDR!")
}
