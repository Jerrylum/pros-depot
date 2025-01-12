import { RestEndpointMethodTypes } from '@octokit/rest'
import { BaseTemplate, Depot, ExternalTemplate } from './schema'

/**
 * Represents a repository on GitHub.
 */
export type RepositoryIdentifier = {
  owner: string
  repo: string
}

/**
 * Convert a string to a repository identifier
 *
 * If the string is not a valid repository name (without a slash), an error is thrown
 *
 * For example, "jerrylum/My-Project" -> { owner: "jerrylum", repo: "My-Project" }
 *
 * @param owner_and_repo_name - The string to convert
 * @returns The repository identifier
 */
export function toRepositoryIdentifier(
  owner_and_repo_name: string
): RepositoryIdentifier {
  if (!owner_and_repo_name.includes('/'))
    throw new Error(`Invalid repository name: ${owner_and_repo_name}`)
  const [owner, repo] = owner_and_repo_name.split('/')
  return { owner, repo }
}

/**
 * Represents a GitHub release you can find on the Releases page of a repository
 */
export type Release =
  RestEndpointMethodTypes['repos']['listReleases']['response']['data'][number]

/**
 * Represents a single asset which appears to be a zip file from a GitHub release.
 * A release can have multiple assets. This is one of those assets.
 *
 * We assume that the zip file is a template zip file and we will attempt to
 * parse the `template.pros` file in the zip if it exists. The `result` field is
 * used to store the template information.
 */
export type DownloadableZip = {
  asset_id: number
  download_url: string
  updated_at: string // ISO 8601
  prerelease: boolean
  result: BaseTemplate | null
}

/**
 * Get the list of downloadable zip files from a GitHub release. Assets that are
 * not zip files are ignored.
 *
 * @param release - The GitHub release
 * @returns The list of downloadable zip files
 */
export function getDownloadableZips(release: Release): DownloadableZip[] {
  return release.assets
    .filter(asset => asset.name.endsWith('.zip'))
    .map(asset => ({
      asset_id: asset.id,
      download_url: asset.browser_download_url,
      updated_at: asset.updated_at,
      prerelease: release.prerelease,
      result: null
    }))
}

/**
 * Check if the zip has been updated after the target date
 *
 * For example, if the zip was updated on 2025-01-01 and the target date is
 * 2025-01-02, then this function will return false.
 *
 * We use this function to determine if we should re-download the zip file.
 *
 * @param zip - The zip to check
 * @param target_date - The target date
 * @returns True if the zip has been updated after the target date, false otherwise
 */
export function hasBeenUpdatedAfter(
  zip: DownloadableZip,
  target_date: Date
): boolean {
  return new Date(zip.updated_at) > target_date
}

/**
 * Convert an external template to a base template.
 *
 * @param zip - The zip file
 * @param external_template - The external template, which is the content of the
 * template.pros file in the same zip file.
 * @returns The base template
 */
export function convertExternalTemplateToBaseTemplate(
  zip: DownloadableZip,
  external_template: ExternalTemplate
): BaseTemplate {
  const template_data = external_template['py/state']
  return {
    metadata: {
      location: zip.download_url
    },
    name: template_data.name,
    'py/object': 'pros.conductor.templates.base_template.BaseTemplate',
    supported_kernels: template_data.supported_kernels,
    target: template_data.target,
    version: template_data.version
  } satisfies BaseTemplate
}

/**
 * Apply the previous result to the zip file.
 *
 * If the zip has been updated before or at the depot last updated time, then we
 * can use the previous result. Otherwise, we should re-download the zip file by
 * setting the result to null. We will download the zip file in the next step if
 * the result is null.
 *
 * @param zip - The zip file
 * @param depot_map - The depot map
 * @param depot_last_updated - The last updated time of the depot
 * @returns The zip file with the previous result applied
 */
export function applyPreviousResult(
  zip: DownloadableZip,
  depot_map: Map<string, BaseTemplate>,
  depot_last_updated: Date
): DownloadableZip {
  return {
    ...zip,
    result: hasBeenUpdatedAfter(zip, depot_last_updated)
      ? null
      : getPreviousResult(zip, depot_map)
  }
}

/**
 * Get the previous result from the depot map.
 *
 * @param zip - The zip file
 * @param depot_map - The depot map
 * @returns The previous result
 */
export function getPreviousResult(
  zip: DownloadableZip,
  depot_map: Map<string, BaseTemplate>
): BaseTemplate | null {
  return depot_map.get(zip.download_url) ?? null
}

export type IncludeStrategy = 'all' | 'stable-only' | 'prerelease-only'

/**
 * Get the include strategy from the input.
 *
 * If the input is not a valid include strategy, an error is thrown.
 *
 * @param input - The input
 * @returns The include strategy
 */
export function getIncludeStrategy(input: string): IncludeStrategy {
  if (
    input === 'all' ||
    input === 'stable-only' ||
    input === 'prerelease-only'
  ) {
    return input
  } else {
    throw new Error(`Invalid include strategy: ${input}`)
  }
}

/**
 * Check if the zip should be included based on the include strategy.
 *
 * @param zip - The zip file
 * @param include_strategy - The include strategy
 * @returns True if the zip should be included, false otherwise
 */
export function shouldIncludeZip(
  zip: DownloadableZip,
  include_strategy: IncludeStrategy
): boolean {
  if (include_strategy === 'stable-only') {
    return !zip.prerelease
  } else if (include_strategy === 'prerelease-only') {
    return zip.prerelease
  } else {
    return true
  }
}

/**
 * Get the commit message for the depot update.
 *
 * @param old_depot - The old depot
 * @param new_depot - The new depot
 * @returns The commit message
 */
export function getCommitMessage(old_depot: Depot, new_depot: Depot): string {
  const old_depot_map = new Map(
    old_depot.map(item => [item.metadata.location, item])
  )

  let added_count = 0
  let updated_count = 0

  for (const new_item of new_depot) {
    const old_item = old_depot_map.get(new_item.metadata.location)
    if (!old_item) {
      added_count++
    } else if (JSON.stringify(old_item) !== JSON.stringify(new_item)) {
      updated_count++
    }
    old_depot_map.delete(new_item.metadata.location)
  }

  const removed_count = old_depot_map.size

  if (added_count === 1 && updated_count === 0 && removed_count === 0) {
    return `Release version ${new_depot[0].version}`
  } else {
    return `Update one or more version(s)`
  }
}
