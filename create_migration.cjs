const fs = require('fs');
const path = require('path');

const file = 'd:/Documents/Bisnis/FizaTalk/supabase/migrations/20260706130000_add_channel_invite.sql';
const content = fs.readFileSync(file, 'utf8');

// The function starts around line 214: CREATE OR REPLACE FUNCTION public.comprehensive_search_action(
const startIndex = content.indexOf('CREATE OR REPLACE FUNCTION public.comprehensive_search_action(');
const searchOrNextStart = content.indexOf('CREATE OR REPLACE FUNCTION public.search_or_next_partner(');

let funcContent = content.substring(startIndex, searchOrNextStart);

// Now we need to insert the lock code inside the BEGIN block
const beginIndex = funcContent.indexOf('BEGIN');
const lockCode = `
  -- 1. Try to acquire advisory lock to prevent double execution (Anti-Spam Button Next)
  IF NOT pg_try_advisory_xact_lock(p_user_id) THEN
    RETURN json_build_object('success', false, 'error', 'concurrent_request');
  END IF;
`;

funcContent = funcContent.substring(0, beginIndex + 5) + lockCode + funcContent.substring(beginIndex + 5);

const newMigration = `
-- Migration to add advisory lock to comprehensive_search_action to prevent double execution
${funcContent}
`;

// Current timestamp format: YYYYMMDDHHMMSS
const now = new Date();
const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
const outPath = `d:/Documents/Bisnis/FizaTalk/supabase/migrations/${timestamp}_add_advisory_lock_to_comprehensive_search.sql`;

fs.writeFileSync(outPath, newMigration);
console.log('Created migration:', outPath);
