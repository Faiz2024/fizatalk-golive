import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { visiblePartnerPhoto } from '../_shared/profile-photo-visibility.ts';

const alice = { profile_photo_enabled: true, is_face_verified: true, profile_photo_file_id: 'alice_photo' };
const bob = { profile_photo_enabled: true, is_face_verified: true, profile_photo_file_id: 'bob_photo' };

Deno.test('both enabled and verified users see each other photos', () => {
  assertEquals(visiblePartnerPhoto(alice, bob), 'bob_photo');
});

Deno.test('viewer without photo mode still sees enabled partner photo', () => {
  assertEquals(visiblePartnerPhoto({ ...alice, profile_photo_enabled: false }, bob), 'bob_photo');
  assertEquals(visiblePartnerPhoto(undefined, bob), 'bob_photo');
});

Deno.test('disabled partner photo is hidden', () => {
  assertEquals(visiblePartnerPhoto(alice, { ...bob, profile_photo_enabled: false }), null);
});

Deno.test('unverified or invalid partner photo is hidden', () => {
  assertEquals(visiblePartnerPhoto(alice, { ...bob, is_face_verified: false }), null);
  assertEquals(visiblePartnerPhoto(alice, undefined), null);
  assertEquals(visiblePartnerPhoto(alice, { ...bob, profile_photo_file_id: ' ' }), null);
});
