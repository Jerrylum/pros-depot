import * as core from '@actions/core'
import { Octokit, RestEndpointMethodTypes } from '@octokit/rest'
// import { wait } from './wait'
// import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods/dist-types/generated/types'

export type RepositoryIdentifier = {
  owner: string
  repo: string
}

export function toRepositoryIdentifier(
  owner_n_repo: string
): RepositoryIdentifier {
  const [owner, repo] = owner_n_repo.split('/')
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
  download_url: string
  updated_at: string // ISO 8601
  prerelease: boolean
}

export function getDownloadableZips(release: Release): DownloadableZip[] {
  return release.assets
    .filter(asset => asset.content_type === 'application/x-zip-compressed')
    .map(asset => ({
      download_url: asset.browser_download_url,
      updated_at: asset.updated_at,
      prerelease: release.prerelease
    }))
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  const rid = toRepositoryIdentifier('LemLib/LemLib')

  // fetch all releases from the repo using the GitHub API
  const releases = await fetchReleases(rid)

  const zips = releases.map(getDownloadableZips).flat()

  core.debug(JSON.stringify(zips, null, 2))
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
