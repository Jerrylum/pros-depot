import * as core from '@actions/core'
import { Octokit, RestEndpointMethodTypes } from '@octokit/rest'
import {
  BaseTemplate,
  Depot,
  DepotSchema,
  ExternalTemplate,
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

export async function listReleases(
  rid: RepositoryIdentifier
): Promise<Release[] | null> {
  try {
    const octokit = getOctokit()
    const { owner, repo } = rid
    const response = await octokit.rest.repos.listReleases({ owner, repo })
    return response.data
  } catch (error) {
    core.warning(
      `Failed to fetch releases from ${rid.owner}/${rid.repo}. ${String(error)}`
    )
    return null
  }
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

export type FileContent = { sha: string; content: string; last_modified: Date }

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

    const sha = response.data.sha
    const content = Buffer.from(response.data.content, 'base64').toString()
    core.debug(`Content: ${content}`)

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

    return { sha, content, last_modified }
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
        `Failed to parse the file as a depot. ${String(parse_result.error)}`
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

export function parseExternalTemplate(
  content: string
): ExternalTemplate | null {
  try {
    const parsed = JSON.parse(content) as unknown
    const parse_result = ExternalTemplateSchema.safeParse(parsed)
    if (parse_result.success) {
      return parse_result.data
    } else {
      core.warning(
        `Failed to parse the file as a base template. ${String(parse_result.error)}`
      )
      return null
    }
  } catch {
    core.warning(
      `Failed to parse the file as a base template. The file content is not a valid JSON.`
    )
    return null
  }
}

export async function getExternalTemplateFromZip(
  rid: RepositoryIdentifier,
  zip: DownloadableZip
): Promise<ExternalTemplate | null> {
  const octokit = getOctokit()
  try {
    core.debug(`Start asset id: ${zip.asset_id}`)

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
      core.warning(
        `No template.pros file found in the zip at ${zip.download_url} (${zip.asset_id})`
      )
      return null
    }

    const template = parseExternalTemplate(
      template_json_entry.getData().toString()
    )
    if (template) {
      return template
    } else {
      core.warning(
        `Failed to parse the template.pros file in the zip at ${zip.download_url} (${zip.asset_id})`
      )
      return null
    }
  } catch (error) {
    core.warning(`Failed to download the template. ${String(error)}`)
    return null
  }
}

export async function createBaseTemplate(
  rid: RepositoryIdentifier,
  zip: DownloadableZip
): Promise<BaseTemplate | null> {
  if (zip.result !== null) {
    core.debug(
      `Using previous result for ${zip.download_url} (${zip.asset_id})`
    )
    return Promise.resolve(zip.result)
  } else {
    core.info(
      `Fetching external template from ${zip.download_url} (${zip.asset_id})`
    )
    const template = await getExternalTemplateFromZip(rid, zip)
    return template
      ? convertExternalTemplateToBaseTemplate(zip, template)
      : null
  }
}

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

export async function pushFile(
  rid: RepositoryIdentifier,
  branch: string,
  path: string,
  content: string,
  commit_message: string,
  old_sha: string | null
): Promise<boolean> {
  //  git checkout --orphan depot && git rm -rf . && git commit --allow-empty -m "Initial empty commit"

  const octokit = getOctokit()
  const { owner, repo } = rid

  try {
    // Check if the branch already exists
    await octokit.rest.repos.getBranch({
      owner,
      repo,
      branch
    })
    core.info(`Branch '${branch}' already exists.`)

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      branch,
      path,
      message: commit_message,
      content: Buffer.from(content).toString('base64'),
      sha: old_sha ?? undefined
    })
    return true
  } catch (error) {
    if (
      error instanceof Error &&
      'status' in error &&
      typeof error.status === 'number' &&
      error.status === 404
    ) {
      core.info(
        `Branch '${branch}' does not exist. Creating a new orphan branch.`
      )
    } else {
      core.error(
        `Failed to check if branch '${branch}' exists. ${String(error)}`
      )
      return false
    }

    try {
      const { data: treeSHA } = await octokit.rest.git.createTree({
        owner,
        repo,
        base_tree: undefined,
        tree: [{ path, mode: '100644', type: 'blob', content }]
      })

      // Create an empty commit
      const { data: newCommit } = await octokit.rest.git.createCommit({
        owner,
        repo,
        message: commit_message,
        tree: treeSHA.sha,
        parents: []
      })

      // Create the new orphan branch
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: newCommit.sha
      })

      return true
    } catch (error) {
      core.error(`Failed to create the new orphan branch. ${String(error)}`)
      return false
    }
  }
}

export type IncludeStrategy = 'all' | 'stable-only' | 'prerelease-only'

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

export function getCommitMessage(old_depot: Depot, new_depot: Depot): string {
  const updated_count = new_depot.length - old_depot.length
  const old_depot_list = old_depot.map(item => item.metadata.location)

  const added_templates = new_depot.filter(
    item => !old_depot_list.includes(item.metadata.location)
  )
  if (added_templates.length === 1) {
    return `Release version ${added_templates[0].version}`
  } else {
    return `Update ${updated_count} version(s)`
  }
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  const include_strategy = getIncludeStrategy(
    core.getInput('include_prereleases')
  )
  const is_push = core.getInput('push') === 'true'
  const target_repo =
    core.getInput('target_repo') || process.env.GITHUB_REPOSITORY || ''
  const target_repo_rid = toRepositoryIdentifier(target_repo)
  const target_branch = core.getInput('target_branch')
  const target_path = core.getInput('target_path')

  core.info(
    `Getting the current depot from the target repository ${target_repo_rid.owner}/${target_repo_rid.repo}`
  )

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

  core.info(
    `Getting releases from the source repository ${source_rid.owner}/${source_rid.repo}`
  )

  const releases = await listReleases(source_rid)
  if (releases === null) {
    core.setFailed(`Failed to fetch releases`)
    return
  }

  const zips = releases
    // Get the downloadable zips from the releases
    .map(getDownloadableZips)
    // Flatten the array of arrays
    .flat()
    // Filter the zips based on the include strategy
    .filter(zip => shouldIncludeZip(zip, include_strategy))
    // Remove the zips that we checked before and were not templates
    .filter(
      zip =>
        !(
          hasBeenUpdatedAfter(zip, curr_depot_last_updated) &&
          getPreviousResult(zip, curr_depot_map) === null &&
          curr_depot_file !== null
        )
    )
    // Add the previous result to the zip if the result is before the last updated date
    .map(zip =>
      applyPreviousResult(zip, curr_depot_map, curr_depot_last_updated)
    )

  const num_of_fetching = zips.filter(zip => !zip.result).length

  if (num_of_fetching === 0) {
    core.info(`Depot ${target_path} is already up to date`)
    return
  }

  core.info(`Fetching ${num_of_fetching} templates`)

  const fetched_templates = []
  for (const zip of zips) {
    fetched_templates.push(await createBaseTemplate(source_rid, zip))
  }

  core.info(`Finished fetching templates`)

  const new_depot = fetched_templates.filter(
    template => template !== null
  ) satisfies Depot

  const new_depot_string = JSON.stringify(new_depot, null, 2)

  core.debug(`Depot: ${new_depot_string}`)
  core.setOutput('depot', new_depot_string)

  if (!is_push) {
    core.info(`Skipping push`)
    return
  }

  core.info(
    `Pushing the file to the target repository ${target_repo_rid.owner}/${target_repo_rid.repo}`
  )

  const commit_message = getCommitMessage(curr_depot, new_depot)

  core.info(`Commit message: ${commit_message}`)

  const success = await pushFile(
    target_repo_rid,
    target_branch,
    target_path,
    new_depot_string,
    commit_message,
    curr_depot_file?.sha ?? null
  )

  if (!success) {
    core.setFailed(`Failed to push the file`)
    return
  }
}
