export const LATEST_RELEASE_API_URL = "https://api.github.com/repos/xiaopu-ai/TO-DO-Panel/releases/latest";

export function selectWindowsDownloadUrl(release) {
  if (!release || !Array.isArray(release.assets) || typeof release.tag_name !== 'string') return null;
  const name = `TO-DO-Panel-${release.tag_name.replace(/^v/, '')}-windows-x64-setup.exe`;
  return release.assets.find((asset) => asset?.name === name && asset.state === 'uploaded'
    && typeof asset.browser_download_url === 'string')?.browser_download_url ?? null;
}

export function selectMacDownloadUrl(release) {
  if (!release || !Array.isArray(release.assets)) return null;

  const installableAssets = release.assets.filter((candidate) => (
    candidate?.state === "uploaded"
    && typeof candidate.name === "string"
    && candidate.name.endsWith("-arm64.dmg")
    && typeof candidate.browser_download_url === "string"
  ));
  const releaseVersion = typeof release.tag_name === "string"
    ? release.tag_name.replace(/^v/, "")
    : "";
  const expectedAssetName = releaseVersion
    ? `TO-DO-Panel-${releaseVersion}-arm64.dmg`
    : "";
  const asset = installableAssets.find((candidate) => candidate.name === expectedAssetName)
    ?? installableAssets[0];

  return asset?.browser_download_url ?? null;
}
