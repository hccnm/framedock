export type VideoFramePosition = "first" | "last" | "current" | "time";

export async function captureVideoFrame(source: string, position: VideoFramePosition, currentTime: number) {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    try {
        const metadataLoaded = waitForVideo(video, "loadedmetadata");
        video.src = source;
        video.load();

        await metadataLoaded;
        if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("无法读取视频时长");
        if (position === "time" && (!Number.isFinite(currentTime) || currentTime < 0 || currentTime >= video.duration)) throw new Error(`截帧时间必须大于等于 0 且小于视频时长 ${video.duration} 秒`);
        const endTime = Math.max(0, video.duration - 0.001);
        const time = position === "first" ? 0 : position === "last" ? endTime : position === "time" ? currentTime : Math.min(currentTime, endTime);
        if (time) {
            const seeked = waitForVideo(video, "seeked");
            video.currentTime = time;
            await seeked;
        } else if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            await waitForVideo(video, "loadeddata");
        }

        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d")!.drawImage(video, 0, 0);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("Failed to capture video frame"))), "image/png"));
        return { blob, time };
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}

function waitForVideo(video: HTMLVideoElement, eventName: "loadedmetadata" | "loadeddata" | "seeked") {
    return new Promise<void>((resolve, reject) => {
        const finish = () => {
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", fail);
            resolve();
        };
        const fail = () => {
            video.removeEventListener(eventName, finish);
            video.removeEventListener("error", fail);
            reject(new Error("Failed to read video frame"));
        };
        video.addEventListener(eventName, finish);
        video.addEventListener("error", fail);
    });
}
