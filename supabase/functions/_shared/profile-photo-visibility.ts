export interface PhotoProfile {
  profile_photo_enabled?: boolean | null;
  is_face_verified?: boolean | null;
  profile_photo_file_id?: string | null;
}

// One-way: the partner's photo is shown when the partner enabled photo mode and is verified,
// regardless of the viewer's own mode. Fails closed on missing data.
export function visiblePartnerPhoto(
  _viewer: PhotoProfile | null | undefined,
  partner: PhotoProfile | null | undefined,
): string | null {
  if (partner?.profile_photo_enabled !== true || partner?.is_face_verified !== true) return null;
  const fileId = partner.profile_photo_file_id;
  return typeof fileId === 'string' && fileId.trim().length > 0 ? fileId : null;
}
