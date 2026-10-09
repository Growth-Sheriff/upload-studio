import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

const readJson = async (folder: string, file: string) => JSON.parse(await readFile(new URL(`../${folder}/${file}`, import.meta.url), 'utf8'))

it('baseline changes only the three audited-page app enablement flags; all native content stays identical', async () => {
  for (const [file, section] of [['templates/index.json', 'catalog'], ['templates/product.ags-variant.json', 'uploader']]) {
    const baseline = await readJson('performance-baseline', file)
    expect(baseline.sections[section].disabled).toBe(true)
    delete baseline.sections[section].disabled
    expect(baseline).toEqual(await readJson('theme', file))
  }
  const settings = await readJson('performance-baseline', 'config/settings_data.json')
  expect(settings.current.blocks.ags_cart_upload_display.disabled).toBe(true)
  settings.current.blocks.ags_cart_upload_display.disabled = false
  expect(settings).toEqual(await readJson('theme', 'config/settings_data.json'))
  const collection = await readJson('theme', 'templates/collection.json')
  expect(collection).toEqual({ sections: { collection: { type: 'ags-main-collection', settings: {} } }, order: ['collection'] })
})
