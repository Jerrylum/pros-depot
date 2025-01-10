import * as core from '@actions/core'
import { Octokit, RestEndpointMethodTypes } from '@octokit/rest'
import {
  BaseTemplate,
  Depot,
  DepotSchema,
  ExternalTemplateSchema
} from './schema'
import AdmZip from 'adm-zip'
// import { wait } from './wait'

export type RepositoryIdentifier = {
  owner: string
  repo: string
}

export function toRepositoryIdentifier(
  owner_and_repo_name: string
): RepositoryIdentifier {
  const [owner, repo] = owner_and_repo_name.split('/')
  return { owner, repo }
}

export function getOctokit(): Octokit {
  const GITHUB_TOKEN =
    core.getInput('github_token') || process.env.GITHUB_TOKEN || ''
  return new Octokit({ auth: GITHUB_TOKEN })
}

export type Release =
  RestEndpointMethodTypes['repos']['listReleases']['response']['data'][number]

export async function fetchReleases(
  rid: RepositoryIdentifier
): Promise<Release[]> {
  const octokit = getOctokit()
  const { owner, repo } = rid
  const response = await octokit.rest.repos.listReleases({ owner, repo })
  return response.data
}

export type DownloadableZip = {
  asset_id: number
  download_url: string
  updated_at: string // ISO 8601
  prerelease: boolean
  result: BaseTemplate | null
}

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

export type FileContent = { content: string; last_modified: Date }

async function getFileContent(
  rid: RepositoryIdentifier,
  branch: string,
  path: string
): Promise<FileContent | null> {
  try {
    const octokit = getOctokit()
    const response = await octokit.rest.repos.getContent({
      owner: rid.owner,
      repo: rid.repo,
      path,
      ref: branch
    })

    if (Array.isArray(response.data)) {
      throw new Error(`It is a directory, expected a file.`)
    } else if (response.data.type !== 'file') {
      throw new Error(`It is not a file.`)
    }

    const content = Buffer.from(response.data.content, 'base64').toString()
    // core.debug(`Content: ${content}`)

    // Get the last commit for the file to find the last modified date
    const commits = await octokit.rest.repos.listCommits({
      owner: rid.owner,
      repo: rid.repo,
      path,
      sha: branch,
      per_page: 1
    })

    // core.debug(`Commits: ${JSON.stringify(commits.data, null, 2)}`)

    const raw_date = commits.data?.[0].commit.committer?.date
    const last_modified = raw_date ? new Date(raw_date) : new Date(0)

    return { content, last_modified }
  } catch (error) {
    if (
      error instanceof Error &&
      'status' in error &&
      typeof error.status === 'number' &&
      error.status === 404
    ) {
      core.warning(
        `Failed to fetch the file content in branch '${branch}' at '${path}'. It is likely that the file does not exist in this branch.`
      )
    } else {
      core.warning(
        `Failed to fetch the file content in branch '${branch}' at '${path}'. ${String(error)}`
      )
    }
    return null
  }
}

export function parseDepot(content: string): Depot | null {
  try {
    const parsed = JSON.parse(content) as unknown
    const parse_result = DepotSchema.safeParse(parsed)
    if (parse_result.success) {
      return parse_result.data
    } else {
      core.warning(
        `Failed to parse the file as a depot: ${String(parse_result.error)}`
      )
      return null
    }
  } catch {
    core.warning(
      `Failed to parse the file as a depot. The file content is not a valid JSON.`
    )
    return null
  }
}
export async function fetchBaseTemplateFromZip(
  rid: RepositoryIdentifier,
  zip: DownloadableZip
): Promise<BaseTemplate | null> {
  if (zip.result) {
    core.debug(
      `Using previous result for ${zip.download_url} (${zip.asset_id})`
    )
    return zip.result
  }

  core.debug(`Fetching template from ${zip.download_url} (${zip.asset_id})`)

  const octokit = getOctokit()
  try {
    const response = await octokit.rest.repos.getReleaseAsset({
      owner: rid.owner,
      repo: rid.repo,
      asset_id: zip.asset_id,
      headers: { Accept: 'application/octet-stream' }
    })

    const data = response.data
    if (data instanceof ArrayBuffer === false) {
      throw new Error('Not an ArrayBuffer')
    }

    const zip_file = new AdmZip(Buffer.from(data))
    const template_json_entry = zip_file.getEntry('template.pros')
    if (template_json_entry == null) {
      core.debug(
        `No template.pros file found in the zip at ${zip.download_url}.`
      )
      return null
    }

    const template_json = JSON.parse(
      template_json_entry.getData().toString()
    ) as unknown
    const template_info = ExternalTemplateSchema.safeParse(template_json)
    if (template_info.success) {
      const template_data = template_info.data['py/state']
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
    } else {
      throw new Error(
        `Failed to parse the template.pros file: ${String(template_info.error)}`
      )
    }
  } catch (error) {
    core.warning(`Failed to fetch the template. ${String(error)}`)
    return null
  }
}

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

export function getPreviousResult(
  zip: DownloadableZip,
  depot_map: Map<string, BaseTemplate>
): BaseTemplate | null {
  return depot_map.get(zip.download_url) ?? null
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  const target_repo =
    core.getInput('target_repo') || process.env.GITHUB_REPOSITORY || ''
  const target_repo_rid = toRepositoryIdentifier(target_repo)
  const target_branch = core.getInput('target_branch')
  const target_path = core.getInput('target_path')

  const curr_depot_file = await getFileContent(
    target_repo_rid,
    target_branch,
    target_path
  )
  const curr_depot_last_updated = curr_depot_file?.last_modified ?? new Date(0)
  const curr_depot = parseDepot(curr_depot_file?.content ?? '[]') ?? []
  const curr_depot_map = new Map(
    curr_depot.map(item => [item.metadata.location, item])
  )

  core.debug(
    `The last updated date of the depot is ${curr_depot_last_updated.toISOString()}`
  )

  const source_repo =
    process.env.__SOURCE_REPO__ || process.env.GITHUB_REPOSITORY || ''
  const source_rid = toRepositoryIdentifier(source_repo)

  core.debug(`The source repository is ${source_rid.owner}/${source_rid.repo}`)

  const releases = await fetchReleases(source_rid)

  const zips = releases
    // Get the downloadable zips from the releases
    .map(getDownloadableZips)
    // Flatten the array of arrays
    .flat()
    // Remove the zips that we checked before and were not templates
    .filter(
      zip =>
        !(
          hasBeenUpdatedAfter(zip, curr_depot_last_updated) &&
          getPreviousResult(zip, curr_depot_map) === null
        )
    )
    // Add the previous result to the zip if the result is before the last updated date
    .map(zip =>
      applyPreviousResult(zip, curr_depot_map, curr_depot_last_updated)
    )

  core.debug(`Fetching ${zips.filter(zip => !zip.result).length} templates`)

  const fetched_templates = await Promise.all(
    zips.map(async zip => await fetchBaseTemplateFromZip(source_rid, zip))
  )

  core.debug(`Finished fetching templates`)

  const new_depot = fetched_templates.filter(
    template => template !== null
  ) satisfies Depot

  const new_depot_string = JSON.stringify(new_depot, null, 2)

  core.debug(`new_depot_string: ${new_depot_string}`)

  // TODO
  // try {
  //   const ms: string = core.getInput('milliseconds')

  //   // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
  //   core.debug(`Waiting ${ms} milliseconds ...`)

  //   // Log the current timestamp, wait, then log the new timestamp
  //   core.debug(new Date().toTimeString())
  //   await wait(parseInt(ms, 10))
  //   core.debug(new Date().toTimeString())

  //   // Set outputs for other workflow steps to use
  //   core.setOutput('time', new Date().toTimeString())
  // } catch (error) {
  //   // Fail the workflow run if an error occurs
  //   if (error instanceof Error) core.setFailed(error.message)
  // }
}
