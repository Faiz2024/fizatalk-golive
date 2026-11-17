export interface PhotoProfile {
  profile_photo_enabled?: boolean | null;
  is_face_verified?: boolean | null;
  profile_photo_file_id?: string | null;
}

// Fail closed when either user's mode or the partner's verification is missing.
export function visiblePartnerPhoto(
  viewer: PhotoProfile | null | undefined,
  partner: PhotoProfile | null | undefined,
): string | null {
  if (viewer?.profile_photo_enabled !== true ||
    partner?.profile_photo_enabled !== true ||
    partner?.is_face_verified !== true) return null;
  const fileId = partner.profile_photo_file_id;
  return typeof fileId === 'string' && fileId.trim().length > 0 ? fileId : null;
}