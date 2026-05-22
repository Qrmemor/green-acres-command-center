import { supabase } from '@/lib/supabase';
import type { AttachmentCategory, EscalationAttachment } from '@/types';

export const ESTIMATE_PHOTOS_BUCKET = 'estimate-photos';

function cleanFileName(name: string) {
  const extension = name.includes('.') ? `.${name.split('.').pop()}` : '';
  const baseName = name
    .replace(extension, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `${baseName || 'photo'}${extension.toLowerCase()}`;
}

export async function listEscalationAttachments(escalationId: string, category?: AttachmentCategory) {
  let query = supabase
    .from('escalation_attachments')
    .select('*')
    .eq('escalation_id', escalationId)
    .order('created_at', { ascending: false });

  if (category) query = query.eq('attachment_category', category);

  const { data, error } = await query;

  if (error) throw error;
  return (data ?? []) as EscalationAttachment[];
}

export async function uploadEscalationAttachments(escalationId: string, files: File[], category: AttachmentCategory = 'estimate') {
  if (!files.length) return [];

  const { data: userData } = await supabase.auth.getUser();
  const uploaded: EscalationAttachment[] = [];

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      throw new Error(`${file.name} is not an image file.`);
    }

    const filePath = `${escalationId}/${Date.now()}-${crypto.randomUUID()}-${cleanFileName(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from(ESTIMATE_PHOTOS_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type
      });

    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage
      .from(ESTIMATE_PHOTOS_BUCKET)
      .getPublicUrl(filePath);

    const { data, error } = await supabase
      .from('escalation_attachments')
      .insert({
        escalation_id: escalationId,
        attachment_category: category,
        file_name: file.name,
        file_path: filePath,
        file_url: publicUrlData.publicUrl,
        file_type: file.type,
        file_size: file.size,
        created_by: userData.user?.id ?? null
      })
      .select('*')
      .single();

    if (error) throw error;
    uploaded.push(data as EscalationAttachment);
  }

  return uploaded;
}

export async function deleteEscalationAttachment(attachment: EscalationAttachment) {
  const { error: storageError } = await supabase.storage
    .from(ESTIMATE_PHOTOS_BUCKET)
    .remove([attachment.file_path]);

  if (storageError) throw storageError;

  const { error } = await supabase
    .from('escalation_attachments')
    .delete()
    .eq('id', attachment.id);

  if (error) throw error;
}
