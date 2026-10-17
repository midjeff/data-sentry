export const VIDEO_EXTENSIONS = ['.mov', '.mp4', '.avi', '.mkv', '.webm'] as const;
export const VIDEO_ACCEPT = VIDEO_EXTENSIONS.join(',');
export const VIDEO_FORMAT_DESCRIPTION = VIDEO_EXTENSIONS.join(', ');

export function videoExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}

// MIME metadata is often empty or application/octet-stream for AVI/MKV.
// This is an extension/size check, not a substitute for server-side media validation.
export function isSupportedVideo(file: Pick<File, 'name' | 'size'>): boolean {
  return file.size > 0 && VIDEO_EXTENSIONS.some((extension) => extension === videoExtension(file.name));
}

export function videoFormatLabel(file: Pick<File, 'name'>): string {
  return videoExtension(file.name).slice(1).toUpperCase();
}
