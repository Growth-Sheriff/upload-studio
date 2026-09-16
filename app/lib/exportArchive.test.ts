import { describe, expect, it } from 'vitest'
import {
  getEmptyExportUploadIds,
  getExportItemFileName,
  getExportUploadFolder,
  getMissingExportUploadIds,
} from './exportArchive'

describe('export archive integrity', () => {
  it('reports every requested upload that was not fetched', () => {
    expect(getMissingExportUploadIds(['one', 'two', 'two', 'three'], ['one', 'three'])).toEqual([
      'two',
    ])
  })

  it('reports selected uploads that contain no design items', () => {
    expect(
      getEmptyExportUploadIds([
        { id: 'has-items', items: [{ id: 'item-one' }] },
        { id: 'empty-one', items: [] },
        { id: 'empty-two', items: [] },
      ])
    ).toEqual(['empty-one', 'empty-two'])
  })

  it('preserves the legacy order folder for a single upload', () => {
    expect(getExportUploadFolder('gid://shopify/Order/123456789', 'upload-a', 1)).toBe(
      'order_23456789'
    )
  })

  it('uses distinct upload subfolders when an order has multiple uploads', () => {
    expect(getExportUploadFolder('order-123', 'upload-a', 2)).toBe(
      'order_rder-123/upload_upload-a'
    )
    expect(getExportUploadFolder('order-123', 'upload-b', 2)).toBe(
      'order_rder-123/upload_upload-b'
    )
  })

  it('sanitizes archive paths and keeps duplicate locations distinct by item id', () => {
    expect(getExportItemFileName('../front/../../evil', 'art.WEbP', 'item/one')).toBe(
      '___front_______evil_design_item_one.webp'
    )
    expect(getExportItemFileName('front', 'art.png', 'item-a')).not.toBe(
      getExportItemFileName('front', 'art.png', 'item-b')
    )
  })
})
