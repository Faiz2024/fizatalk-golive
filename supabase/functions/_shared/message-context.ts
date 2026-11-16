export async function getMessageContext(db: any, userId: number) {
  const { data: envelope, error } = await db.rpc('get_chat_envelope', {
    p_user_id: userId,
  });

  return {
    envelope,
    user: envelope?.user ?? null,
    error,
  };
}
