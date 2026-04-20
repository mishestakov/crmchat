export async function getImageDimensions(file: File) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight };
}

export async function getVideoDimensions(file: File) {
  return new Promise<{ width: number; height: number; duration: number }>(
    (resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.addEventListener(
        "loadedmetadata",
        () => {
          const res = {
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
          };
          URL.revokeObjectURL(url);
          resolve(res);
        },
        { once: true }
      );
      video.addEventListener(
        "error",
        () => {
          URL.revokeObjectURL(url);
          reject(new Error("Could not load video metadata"));
        },
        { once: true }
      );
      video.src = url;
    }
  );
}

export async function getAudioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load audio metadata"));
    });
    audio.src = url;
  });
}
