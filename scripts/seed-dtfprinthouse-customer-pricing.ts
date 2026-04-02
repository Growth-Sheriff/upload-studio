import { PrismaClient, type Prisma } from '@prisma/client'
import {
  buildDtfPrintHouseCustomerPricingSettings,
  buildCustomerPricingSettingsPayload,
  DTF_PRINTHOUSE_DTF_UPLOAD_PRODUCT_ID,
  DTF_PRINTHOUSE_SHOP_DOMAIN,
  DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID,
  type CustomerPricingAssignment,
} from '../app/lib/customerPricing.server'

const prisma = new PrismaClient()

const BUSINESS_CUSTOMERS: Array<{
  customerId: string
  customerName: string
  customerEmail: string
}> = [
  { customerId: '8653193707678', customerName: 'Jodie Brown', customerEmail: 'jmt77084@yahoo.com' },
  { customerId: '8589297844382', customerName: 'Rafael Casillas', customerEmail: 'orders@compassgraphics.net' },
  { customerId: '8360541618334', customerName: 'Debra Dotterweich', customerEmail: 'katiew@bull-shirts.com' },
  { customerId: '8114519998622', customerName: 'Ihsan Biber', customerEmail: 'info@harwindtf.com' },
  { customerId: '8108265767070', customerName: 'Marcus Watkins', customerEmail: 'tx257@postnet.com' },
  { customerId: '7982760853662', customerName: 'Derek Davis', customerEmail: 'blowingup02@yahoo.com' },
  { customerId: '7970130526366', customerName: 'ASHLEY HARVELL', customerEmail: 'hello@bamatexas.com' },
  { customerId: '7955139199134', customerName: 'Mimi Wright', customerEmail: 'orders@illprint4u.com' },
  { customerId: '7940602298526', customerName: 'David Navarro', customerEmail: 'divad011276@yahoo.com' },
  { customerId: '7855826141342', customerName: 'Nilgun Albayrak', customerEmail: 'nilgun.na@gmail.com' },
  { customerId: '7814566150302', customerName: 'Michael Guzman', customerEmail: 'bplatz@gulfcoastmailingservices.com' },
  { customerId: '7755987779742', customerName: 'Zackry Mayeux', customerEmail: 'coastaldreams4700@yahoo.com' },
  { customerId: '7746455077022', customerName: 'Becki Parsons', customerEmail: 'aatg02@yahoo.com' },
  { customerId: '7744834732190', customerName: 'JOSEPH YILDIRIM', customerEmail: 'printcraftdtf@gmail.com' },
  { customerId: '7678040277150', customerName: 'Diego Cutrera', customerEmail: 'diego@superscreenonline.com' },
  { customerId: '7665251582110', customerName: 'Shola Ajayi', customerEmail: 'sholaajayi@aol.com' },
  { customerId: '7655120240798', customerName: 'Khalid Hakim', customerEmail: 'sales@prontoprints.com' },
  { customerId: '7648415449246', customerName: 'Gustavo Gonzalez', customerEmail: 'info@gooseworkshtx.com' },
  { customerId: '7643064500382', customerName: 'pamela/daylan Fuentez', customerEmail: 'daylanslife@gmail.com' },
  { customerId: '7523408248990', customerName: 'Dan To', customerEmail: 'hotshirts.info@gmail.com' },
  { customerId: '7519253233822', customerName: 'Tamara Wallace', customerEmail: 'iisugarland@gmail.com' },
]

const VIP_CUSTOMERS: CustomerPricingAssignment[] = [
  {
    customerId: '8990208524446',
    customerName: 'DREAM DESIGN MARKETING LLC',
    customerEmail: 'houseofddm@hotmail.com',
    statusKey: 'vip',
    active: true,
    pricePerInchOverride: null,
    productOverrides: [],
  },
  {
    customerId: '8620849856670',
    customerName: 'Saqeefali Momin',
    customerEmail: 'shaq@swagprint.com',
    statusKey: 'vip',
    active: true,
    pricePerInchOverride: 0.16,
    productOverrides: [
      {
        productId: DTF_PRINTHOUSE_DTF_UPLOAD_PRODUCT_ID,
        pricePerInch: 0.16,
      },
    ],
  },
]

function buildAssignments(): CustomerPricingAssignment[] {
  return BUSINESS_CUSTOMERS.map((customer) => ({
    customerId: customer.customerId,
    customerName: customer.customerName,
    customerEmail: customer.customerEmail,
    statusKey: 'business',
    active: true,
    pricePerInchOverride: null,
    productOverrides: [],
  })).concat(VIP_CUSTOMERS)
}

function mergeBuilderConfig(rawConfig: Prisma.JsonValue | null | undefined) {
  const current =
    rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
      ? (rawConfig as Record<string, unknown>)
      : {}

  return {
    ...current,
    maxWidthIn: 22,
    minWidthIn: 1,
    maxHeightIn: 240,
    minHeightIn: 1,
    artboardMarginIn: 0,
    imageMarginIn: 0,
  }
}

async function main() {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: DTF_PRINTHOUSE_SHOP_DOMAIN },
    select: { id: true, settings: true },
  })

  if (!shop) {
    throw new Error(`Shop not found for ${DTF_PRINTHOUSE_SHOP_DOMAIN}`)
  }

  const settings = buildDtfPrintHouseCustomerPricingSettings()
  settings.assignments = buildAssignments()

  const nextSettings = {
    ...((shop.settings as Record<string, unknown> | null) || {}),
    customerPricing: buildCustomerPricingSettingsPayload(settings) as Prisma.InputJsonValue,
  } as Prisma.InputJsonObject

  await prisma.shop.update({
    where: { shopDomain: DTF_PRINTHOUSE_SHOP_DOMAIN },
    data: { settings: nextSettings },
  })

  for (const productId of [
    DTF_PRINTHOUSE_DTF_UPLOAD_PRODUCT_ID,
    DTF_PRINTHOUSE_UV_UPLOAD_PRODUCT_ID,
  ]) {
    const existing = await prisma.productConfig.findUnique({
      where: {
        shopId_productId: {
          shopId: shop.id,
          productId,
        },
      },
      select: {
        builderConfig: true,
      },
    })

    await prisma.productConfig.upsert({
      where: {
        shopId_productId: {
          shopId: shop.id,
          productId,
        },
      },
      update: {
        uploadEnabled: true,
        builderConfig: mergeBuilderConfig(existing?.builderConfig),
      },
      create: {
        shopId: shop.id,
        productId,
        uploadEnabled: true,
        mode: 'dtf',
        enabled: true,
        builderConfig: mergeBuilderConfig(null),
      },
    })
  }

  console.log(
    JSON.stringify(
      {
        shopDomain: DTF_PRINTHOUSE_SHOP_DOMAIN,
        assignments: settings.assignments.length,
        businessCustomers: BUSINESS_CUSTOMERS.length,
        vipCustomers: VIP_CUSTOMERS.length,
        productsUpdated: 2,
      },
      null,
      2
    )
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
