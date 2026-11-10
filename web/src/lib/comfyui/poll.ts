/** Queue poll cadence, shared by canvas runs and the workflow test area. Polling never times out on its own. */
export const COMFY_POLL_PRESETS = [1, 3, 5, 10];
export const MIN_COMFY_POLL_SECONDS = 1;
export const DEFAULT_COMFY_POLL_SECONDS = 3;

/** Custom intervals have no upper bound; anything below the minimum is raised to it. */
export function clampComfyPollSeconds(seconds: number) {
    return Number.isFinite(seconds) ? Math.max(MIN_COMFY_POLL_SECONDS, seconds) : DEFAULT_COMFY_POLL_SECONDS;
}

export function comfyPollDelayMs(seconds: number = DEFAULT_COMFY_POLL_SECONDS) {
    return Math.round(clampComfyPollSeconds(seconds) * 1000);
}
