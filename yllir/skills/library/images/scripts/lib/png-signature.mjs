// The eight bytes every PNG file starts with. Shared by the built-in image providers
// and the campaign command/http runner to check that a result really is a PNG.

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
