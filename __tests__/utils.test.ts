import { BaseTemplate, ExternalTemplate } from '../src/schema'
import {
  applyPreviousResult,
  convertExternalTemplateToBaseTemplate,
  DownloadableZip,
  getCommitMessage,
  getDownloadableZips,
  getIncludeStrategy,
  getPreviousResult,
  Release,
  shouldIncludeZip,
  toRepositoryIdentifier
} from '../src/utils'

describe('utils', () => {
  // The repository name can only contain ASCII letters, digits, and the characters ., -, and _.
  it('toRepositoryIdentifier', () => {
    expect(toRepositoryIdentifier('jerrylum/PROS-Test-Project')).toEqual({
      owner: 'jerrylum',
      repo: 'PROS-Test-Project'
    })

    expect(toRepositoryIdentifier('jerrylum/')).toEqual({
      owner: 'jerrylum',
      repo: ''
    })

    expect(toRepositoryIdentifier('/')).toEqual({
      owner: '',
      repo: ''
    })

    expect(() => toRepositoryIdentifier('')).toThrow()

    expect(() => toRepositoryIdentifier('jerrylum')).toThrow()
  })

  it('getDownloadableZips', () => {
    const release = {
      assets: [
        {
          id: 1,
          browser_download_url: 'https://example.com/download',
          updated_at: '2021-01-01T00:00:00Z',
          name: 'example.zip'
        },
        {
          id: 2,
          browser_download_url: 'https://example.com/download',
          updated_at: '2021-01-01T00:00:00Z',
          name: 'zip'
        }
      ],
      prerelease: false
    } as Release

    expect(getDownloadableZips(release)).toEqual([
      {
        asset_id: 1,
        download_url: 'https://example.com/download',
        updated_at: '2021-01-01T00:00:00Z',
        prerelease: false,
        result: null
      }
    ])

    const release2 = {
      assets: [] as Release['assets'],
      prerelease: false
    } as Release

    expect(getDownloadableZips(release2)).toEqual([])
  })

  it('convertExternalTemplateToBaseTemplate', () => {
    const zip = {
      download_url: 'https://example.com/download',
      asset_id: 1,
      updated_at: '2021-01-01T00:00:00Z',
      prerelease: false,
      result: null
    } satisfies DownloadableZip

    const external_template = {
      'py/state': {
        metadata: {},
        name: 'example',
        supported_kernels: '4.1.2',
        system_files: ['system.pros'],
        target: 'v5',
        user_files: ['user.pros'],
        version: '1.0.0'
      },
      'py/object': 'pros.conductor.templates.external_template.ExternalTemplate'
    } satisfies ExternalTemplate

    const base_template = convertExternalTemplateToBaseTemplate(
      zip,
      external_template
    )

    expect(base_template).toEqual({
      metadata: { location: 'https://example.com/download' },
      name: 'example',
      supported_kernels: '4.1.2',
      target: 'v5',
      version: '1.0.0',
      'py/object': 'pros.conductor.templates.base_template.BaseTemplate'
    })
  })

  it('applyPreviousResult', () => {
    const zip = {
      download_url: 'https://example.com/download',
      asset_id: 1,
      updated_at: '2021-01-01T00:00:00Z',
      prerelease: false,
      result: null
    } satisfies DownloadableZip

    const result = {
      metadata: { location: 'https://example.com/download' },
      name: 'example',
      supported_kernels: '4.1.2',
      target: 'v5',
      version: '1.0.0',
      'py/object': 'pros.conductor.templates.base_template.BaseTemplate'
    } satisfies BaseTemplate

    const depot_map = new Map<string, BaseTemplate>()
    depot_map.set(zip.download_url, result)

    const new_zip1 = applyPreviousResult(
      zip,
      depot_map,
      new Date('2021-01-01T00:00:00Z')
    )
    expect(new_zip1).toEqual({ ...zip, result })

    const new_zip2 = applyPreviousResult(
      zip,
      depot_map,
      new Date('2021-01-01T00:00:01Z')
    )
    expect(new_zip2).toEqual({ ...zip, result })

    const new_zip3 = applyPreviousResult(
      zip,
      depot_map,
      new Date('2020-12-31T23:59:59Z')
    )
    expect(new_zip3).toEqual({ ...zip, result: null })
  })

  it('getPreviousResult', () => {
    const zip = {
      download_url: 'https://example.com/download',
      asset_id: 1,
      updated_at: '2021-01-01T00:00:00Z',
      prerelease: false,
      result: null
    } satisfies DownloadableZip

    const result = {
      metadata: { location: 'https://example.com/download' },
      name: 'example',
      supported_kernels: '4.1.2',
      target: 'v5',
      version: '1.0.0',
      'py/object': 'pros.conductor.templates.base_template.BaseTemplate'
    } satisfies BaseTemplate

    const depot_map = new Map<string, BaseTemplate>()
    depot_map.set(zip.download_url, result)

    expect(getPreviousResult(zip, depot_map)).toEqual(result)
  })

  it('getIncludeStrategy', () => {
    expect(getIncludeStrategy('all')).toEqual('all')
    expect(getIncludeStrategy('stable-only')).toEqual('stable-only')
    expect(getIncludeStrategy('prerelease-only')).toEqual('prerelease-only')
    expect(() => getIncludeStrategy('invalid')).toThrow()
    expect(() => getIncludeStrategy('')).toThrow()
  })

  it('shouldIncludeZip', () => {
    expect(
      shouldIncludeZip({ prerelease: false } as DownloadableZip, 'all')
    ).toEqual(true)
    expect(
      shouldIncludeZip({ prerelease: true } as DownloadableZip, 'all')
    ).toEqual(true)
    expect(
      shouldIncludeZip({ prerelease: false } as DownloadableZip, 'stable-only')
    ).toEqual(true)
    expect(
      shouldIncludeZip({ prerelease: true } as DownloadableZip, 'stable-only')
    ).toEqual(false)
    expect(
      shouldIncludeZip(
        { prerelease: false } as DownloadableZip,
        'prerelease-only'
      )
    ).toEqual(false)
    expect(
      shouldIncludeZip(
        { prerelease: true } as DownloadableZip,
        'prerelease-only'
      )
    ).toEqual(true)
  })

  it('getCommitMessage', () => {
    expect(getCommitMessage([], [])).toEqual('Update one or more version(s)')
    expect(
      // Added one template
      getCommitMessage(
        [],
        [
          {
            metadata: { location: 'https://example.com/download1' },
            version: '1.0.0'
          } as BaseTemplate
        ]
      )
    ).toEqual('Release version 1.0.0')
    expect(
      // Added two templates
      getCommitMessage(
        [],
        [
          {
            metadata: { location: 'https://example.com/download1' }
          } as BaseTemplate,
          {
            metadata: { location: 'https://example.com/download2' }
          } as BaseTemplate
        ]
      )
    ).toEqual('Update one or more version(s)')
    expect(
      // Removed one template
      getCommitMessage(
        [
          {
            metadata: { location: 'https://example.com/download1' }
          } as BaseTemplate
        ],
        []
      )
    ).toEqual('Update one or more version(s)')
    expect(
      getCommitMessage(
        [
          {
            metadata: { location: 'https://example.com/download1' }
          } as BaseTemplate
        ],
        [
          {
            metadata: { location: 'https://example.com/download2' },
            version: '2.0.0'
          } as BaseTemplate
        ]
      )
    ).toEqual('Update one or more version(s)')
    expect(
      // Updated one template
      getCommitMessage(
        [
          {
            metadata: { location: 'https://example.com/download1' },
            version: '1.0.0'
          } as BaseTemplate
        ],
        [
          {
            metadata: { location: 'https://example.com/download1' },
            version: '1.0.1'
          } as BaseTemplate
        ]
      )
    ).toEqual('Update one or more version(s)')
  })
})
