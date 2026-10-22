import { evidenceValid, reportKeyboard, reportRule, type ReportContext } from './report-policy.ts';
type Dependencies = { db: any; call: (method: string, body: any) => Promise<any>; adminChat: string | undefined; now?: () => Date };
const wib = (d: Date) => d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
const ok = () => new Response('OK');
const fail = () => new Response('Database Error', { status: 500 });
async function adminAllowed(q: any, d: Dependencies) {
 if (!d.adminChat || String(q.message?.chat?.id) !== d.adminChat) return false;
 if (Number(d.adminChat)>0) return q.from.id===Number(d.adminChat);
 const m=await d.call('getChatMember',{chat_id:d.adminChat,user_id:q.from.id});
 return m?.ok && ['creator','administrator'].includes(m.result?.status);
}
export async function handleReportCallback(q: any,d: Dependencies): Promise<Response|null> {
 let data=String(q.data||''); const m=q.message; const user=q.from.id;
 const old=data.match(/^(rspam|rmx)_([a-z])_(\d+)$/);
 if(old){if(old[2]==='c')data=`rcback_${old[1]==='rspam'?'link':'media'}_${old[3]}`;
 else data=`rc_${old[1]==='rspam'?'link':'media'}_${old[1]==='rspam'?(old[2]==='v'?'sexual':'promotion'):(old[2]==='a'?'sexual':'fraud')}_${old[3]}`;}
 const legacy=data.match(/^rate_(spam|sange)_(\d+)$/);
 if(legacy)data=`rc_partner_${legacy[1]==='spam'?'spam':'harassment'}_${legacy[2]}`;
 const answer=(text='')=>d.call('answerCallbackQuery',{callback_query_id:q.id,text});
 const edit=(kb:any)=>d.call('editMessageReplyMarkup',{chat_id:m.chat.id,message_id:m.message_id,reply_markup:kb});
 const adminAction=data.match(/^admin_(warnm|blockm|warn|block)_(\d+)$/);
 if(adminAction){
  if(!m||!await adminAllowed(q,d)){await answer('Hanya admin berwenang.');return ok();}
  const action=adminAction[1].startsWith('warn')?'warn':'block';
  const {data:r,error}=await d.db.rpc('admin_process_media_report',{p_sender_id:Number(adminAction[2]),p_action:action});
  if(error)return fail();if(!r?.success){await answer('Tindakan tidak dapat diproses.');return ok();}
  await answer('Tindakan tersimpan.');await edit({inline_keyboard:[]});
  await d.call('sendMessage',{chat_id:Number(adminAction[2]),text:action==='warn'?'⚠️ Admin memberikan peringatan pelanggaran. Aturan berlaku bagi semua pengguna, termasuk Premium.':'🚫 Akun dibatasi oleh admin karena pelanggaran. Hubungi @FizaTalkCS untuk sanggahan.'});return ok();
 }
 if (data.startsWith('mod_')) {
  if (!m || !await adminAllowed(q,d)) {await answer('Hanya admin berwenang.');return ok();}
  const match=data.match(/^mod_(ban|reject)_([a-f0-9-]{36})$/);if(!match)return ok();
  const {data:r,error}=await d.db.rpc('resolve_moderation_review',{p_review_id:match[2],p_action:match[1],p_admin_id:user});
  if(error)return fail(); await answer(r?.success?'Keputusan tersimpan.':'Sudah diproses sebelumnya.');await edit({inline_keyboard:[]});
  if(r?.success){
   await d.call('sendMessage',{chat_id:m.chat.id,text:`Keputusan: ${match[1]==='ban'?'Blokir permanen':'Laporan ditolak'} • ${wib(d.now?.()||new Date())}`});
   await d.call('sendMessage',{chat_id:r.target,text:match[1]==='ban'?'🚫 Akun diblokir permanen setelah peninjauan admin. Pembayaran tidak membuka blokir. Sanggahan: @FizaTalkCS.':'✅ Laporan ditolak. Pembatasan laporan ini dicabut tanpa biaya; akses normal jika tidak ada laporan lain menunggu. Masa Premium saat pembekuan diganti.'});
  }return ok();
 }
 if(data==='rc_cancel'){
  const {error}=await d.db.rpc('cancel_report_draft',{p_user_id:user});if(error)return fail();await answer('Kembali.');
  if(m)await edit({inline_keyboard:[[{text:'🔍 Cari Partner',callback_data:'search_partner'}]]});return ok();
 }
 const entry=data.match(/^(report_user|reportspam|reportm)_(\d+)$/);
 const back=data.match(/^rcback_(partner|link|media)_(\d+)$/);
 if(back){if(!m)return ok();await answer();const t=back[1]==='link'?'reportspam':back[1]==='media'?'reportm':'report_user';await edit({inline_keyboard:[[{text:'🚩 Laporkan',callback_data:`${t}_${back[2]}`}]]});return ok();}
 if(entry){if(!m)return ok();const c:ReportContext=entry[1]==='report_user'?'partner':entry[1]==='reportspam'?'link':'media';await answer();
  if(c==='partner'){const edited=await d.call('editMessageText',{chat_id:m.chat.id,message_id:m.message_id,text:'🚩 Pilih jenis laporan yang sesuai. Laporan palsu dapat merugikan pengguna lain. Laporan berat memerlukan penjelasan dan bukti aman untuk peninjauan.',reply_markup:reportKeyboard(c,Number(entry[2]))});if(!edited?.ok)await edit(reportKeyboard(c,Number(entry[2])));}
  else await edit(reportKeyboard(c,Number(entry[2])));return ok();}
 const selected=data.match(/^rc_(partner|link|media)_([a-z]+)_(\d+)$/);if(!selected)return null;
 if(!m)return ok();const context=selected[1] as ReportContext;const category=selected[2];const target=Number(selected[3]);const rule=reportRule(context,category);if(!rule||!Number.isSafeInteger(target))return ok();
 if(rule.review){
  if(!d.adminChat){await answer('Peninjauan belum tersedia. Hubungi @FizaTalkCS.');return ok();}
  const {data:r,error}=await d.db.rpc('begin_report_draft',{p_reporter_id:user,p_reported_id:target,p_context:context,p_source_id:m.message_id});
  if(error)return fail();if(!r?.success){await answer('Partner tidak lagi memenuhi syarat laporan.');return ok();}
  await answer();await d.call('sendMessage',{chat_id:user,text:context==='partner'?'🚸 Jelaskan kejadian dengan screenshot percakapan dan caption (10–1000 karakter). Tutupi konten seksual anak dan data pribadi yang tidak diperlukan. Jangan unggah ulang materi ilegal. Laporan akan ditinjau, bukan otomatis vonis permanen.':'🚸 Kirim penjelasan kejadian (10–1000 karakter). Jangan kirim ulang konten seksual anak. Referensi pesan sudah dicatat untuk peninjauan terbatas oleh admin.',reply_markup:{inline_keyboard:[[{text:'⬅️ Kembali',callback_data:'rc_cancel'}]]}});return ok();
 }
 const {data:r,error}=await d.db.rpc('submit_context_report',{p_reporter_id:user,p_reported_id:target,p_context:context,p_category:category});
 if(error)return fail();if(!r?.success){await answer('Laporan tidak diterima: partner tidak sesuai atau laporan tidak valid.');return ok();}
 await answer('Laporan diterima.');await edit({inline_keyboard:[]});
 if(!r.silent){
  const stage=Number(r.sanction_stage||0);if(stage>0)await d.call('sendMessage',{chat_id:target,parse_mode:'HTML',text:stage===1?'🔒 <b>Akun Anda dibatasi</b> karena laporan dari pengguna lain. Tekan Cari Partner lalu Setuju untuk berjanji tidak mengulangi pelanggaran dan langsung melanjutkan penggunaan. Baca /rules.':stage===2?'🚫 <b>Akun Anda diblokir 14 hari</b> karena pelanggaran berulang terhadap ketentuan layanan. Tekan Cari Partner untuk melihat opsi pemulihan. Baca /rules.':'⛔ <b>Akun Anda diblokir 14 hari</b> tanpa opsi pemulihan karena pelanggaran berulang. Baca /rules.'});
  if(d.adminChat){await d.call('sendMessage',{chat_id:d.adminChat,text:`LAPORAN ${context.toUpperCase()}\n${rule.label}\nTerlapor: ${target}\nPelapor: ${user}\n${wib(d.now?.()||new Date())}`,reply_markup:{inline_keyboard:[[{text:'⚠️ Peringatan',callback_data:`admin_warnm_${target}`},{text:'🚫 Blokir',callback_data:`admin_blockm_${target}`}]]}});
   if(context==='link'||(context==='media'&&category==='fraud'))await d.call('copyMessage',{chat_id:d.adminChat,from_chat_id:user,message_id:m.message_id});}
 }
 if(context!=='partner')await d.call('deleteMessage',{chat_id:user,message_id:m.message_id});return ok();
}
export async function handleReportEvidence(m:any,draft:any,d:Dependencies):Promise<Response>{
 const user=m.from.id;const explanation=m.caption||m.text||'';const photo=m.photo?.at(-1)?.file_id||null;
 if(new Date(draft.expires_at).getTime()<Date.now()){const {error}=await d.db.rpc('cancel_report_draft',{p_user_id:user});if(error)return fail();await d.call('sendMessage',{chat_id:user,text:'Waktu pengiriman bukti habis. Buka laporan kembali.'});return ok();}
 if(!evidenceValid(draft.context,explanation,photo)){await d.call('sendMessage',{chat_id:user,text:'Sertakan penjelasan 10–1000 karakter; laporan percakapan memerlukan screenshot aman dengan caption. Jangan kirim materi seksual anak.'});return ok();}
 if(!d.adminChat)return fail();
 const {data:r,error}=await d.db.rpc('submit_context_report',{p_reporter_id:user,p_reported_id:Number(draft.target),p_context:draft.context,p_category:'danger',p_explanation:explanation,p_evidence:draft.context==='partner'?photo:null,p_source_id:Number(draft.source_id)});
 if(error)return fail();if(!r?.success){await d.call('sendMessage',{chat_id:user,text:'Laporan tidak dapat diproses. Buka laporan kembali.'});return ok();}
 const delivered=await d.call('sendMessage',{chat_id:d.adminChat,text:`🚸 PENINJAUAN PRIORITAS\nTerlapor: ${draft.target}\nPelapor: ${user}\nKonteks: ${draft.context}\nReferensi pesan: ${draft.source_id}\n${wib(d.now?.()||new Date())}\n\n${explanation}\n\nTinjau bukti sebelum blokir permanen. Hubungi pelapor untuk bukti aman; jangan teruskan konten seksual anak.`,reply_markup:{inline_keyboard:[[{text:'🚫 Terbukti: Blokir Permanen',callback_data:`mod_ban_${r.review_id}`}],[{text:'✅ Tidak Terbukti: Pulihkan',callback_data:`mod_reject_${r.review_id}`}]]}});
 if(!delivered?.ok)return new Response('Admin notification failed',{status:500});
 // Never redistribute suspected child sexual material automatically. Safe screenshots remain referenced by file ID.
 const {error:clearError}=await d.db.rpc('cancel_report_draft',{p_user_id:user});if(clearError)return fail();
 await d.call('sendMessage',{chat_id:user,text:'✅ Penjelasan diterima untuk peninjauan admin. Akun terlapor dibatasi sementara; ini bukan keputusan bersalah.'});
 await d.call('sendMessage',{chat_id:draft.target,text:'⏳ Akun dibatasi sementara untuk peninjauan laporan serius. Ini bukan vonis bersalah. Sanggahan: @FizaTalkCS. Pembayaran tidak membuka pembatasan.'});return ok();
}
