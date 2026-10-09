import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import manifest from './block-settings.json'

const readJson = async (path: string) => JSON.parse(await readFile(new URL(`../theme/${path}`, import.meta.url), 'utf8'))
const typeFor = (handle: string) => `shopify://apps/${manifest.installedExtension.appHandle}/blocks/${handle}/${manifest.installedExtension.uuid}`

describe('installed public-app demo theme bindings', () => {
  it('places all eight section blocks in the planned sections, using the saved canonical extension ID and native setting IDs', async () => {
    for (const planned of manifest.templates) {
      const template = await readJson(planned.file)
      const section = template.sections[planned.section]
      const blocks = Object.values(section.blocks) as Array<{ type: string; settings: Record<string, unknown> }>
      expect(blocks).toHaveLength(1)
      expect(blocks[0].type).toBe(typeFor(planned.block))
      expect(blocks[0].settings).toEqual(planned.settings)
      expect(section.block_order).toEqual(Object.keys(section.blocks))
      const native = await readFile(new URL(`../../extensions/theme-extension/blocks/${planned.block}.liquid`, import.meta.url), 'utf8')
      const schema = JSON.parse(native.split('{% schema %}')[1].split('{% endschema %}')[0])
      const ids = new Set(schema.settings.map((setting: { id?: string }) => setting.id).filter(Boolean))
      for (const id of Object.keys(planned.settings)) expect(ids.has(id), `${planned.block}.${id} is a native setting`).toBe(true)
    }
    const variant = await readJson('templates/product.ags-variant.json')
    expect(variant.order).toEqual(['intro', 'uploader', 'faq'])
  })

  it('enables the ninth block globally as a cart embed, using the same signed proxy path', async () => {
    const settings = await readJson(manifest.embed.file)
    const embeds = Object.values(settings.current.blocks) as Array<{ type: string; disabled: boolean; settings: Record<string, unknown> }>
    expect(embeds).toHaveLength(1)
    expect(embeds[0]).toEqual({ type: typeFor(manifest.embed.block), disabled: false, settings: manifest.embed.settings })
    const handles = [...manifest.templates.map(block => block.block), manifest.embed.block]
    expect(new Set(handles).size).toBe(9)
    for (const planned of manifest.templates) {
      if ('app_proxy_path' in planned.settings) expect(planned.settings.app_proxy_path).toBe('/apps/customizer')
    }
    expect(manifest.embed.settings.app_proxy_path).toBe('/apps/customizer')
  })
})
