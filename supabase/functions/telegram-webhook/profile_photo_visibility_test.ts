import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { visiblePartnerPhoto } from '../_shared/profile-photo-visibility.ts';

const alice = { profile_photo_enabled: true, is_face_verified: true, profile_photo_file_id: 'alice_photo' };
const bob = { profile_photo_enabled: true, is_face_verified: true, profile_photo_file_id: 'bob_photo' };

Deno.test('both enabled and verified users see each other photos', () => {
  assertEquals(visiblePartnerPhoto(alice, bob), 'bob_photo');
  assertEquals(visiblePartnerPhoto(bob, alice), 'alice_photo');
});

Deno.test('disabled viewer cannot see partner photo, including reconnect', () => {
  assertEquals(visiblePartnerPhoto({ ...alice, profile_photo_enabled: false }, bob), null);
});

Deno.test('enabled viewer cannot see disabled partner photo', () => {
  assertEquals(visiblePartnerPhoto(alice, { ...bob, profile_photo_enabled: false }), null);
});

Deno.test('both disabled users see no photos', () => {
  assertEquals(visiblePartnerPhoto({ ...alice, profile_photo_enabled: false }, { ...bob, profile_photo_enabled: false }), null);
});

Deno.test('unverified partner photo is hidden even with photo mode enabled', () => {
  assertEquals(visiblePartnerPhoto(alice, { ...bob, is_face_verified: false }), null);
});

Deno.test('missing verification, mode, user, or valid photo fails closed', () => {
  assertEquals(visiblePartnerPhoto(undefined, bob), null);
  assertEquals(visiblePartnerPhoto(alice, undefined), null);
  assertEquals(visiblePartnerPhoto({}, bob), null);
  assertEquals(visiblePartnerPhoto(alice, { profile_photo_enabled: true, profile_photo_file_id: 'bob_photo' }), null);
  assertEquals(visiblePartnerPhoto(alice, { ...bob, profile_photo_file_id: null }), null);
  assertEquals(visiblePartnerPhoto(alice, { ...bob, profile_photo_file_id: ' ' }), null);
});