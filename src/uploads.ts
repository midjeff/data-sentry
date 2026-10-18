export type UploadVideo = { id: string; file: File; displayName: string };

export function hasDuplicateFilename(items: UploadVideo[], file: Pick<File, 'name'>): boolean {
  return items.some((item) => item.file.name === file.name || item.displayName === file.name);
}

export function uniqueDisplayName(name: string, items: UploadVideo[]): string {
  const used = new Set(items.map((item) => item.displayName));
  if (!used.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  let number = 1;
  while (used.has(`${stem} (${number})${extension}`)) number++;
  return `${stem} (${number})${extension}`;
}

// Returning the original list leaves an unconfirmed duplicate completely untouched.
export function addUpload(items: UploadVideo[], file: File, confirmed = false): UploadVideo[] {
  if (hasDuplicateFilename(items, file) && !confirmed) return items;
  return [...items, { id: crypto.randomUUID(), file, displayName: uniqueDisplayName(file.name, items) }];
}
