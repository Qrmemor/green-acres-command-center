import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EscalationForm, type EscalationFormAttachments, type EscalationFormValues } from '@/components/forms/EscalationForm';
import { LoadingState } from '@/components/common/LoadingState';
import { createEscalation } from '@/services/escalations';
import { uploadEscalationAttachments } from '@/services/attachments';
import { fallbackOptions, getWorkspaceOptions, type WorkspaceOptions } from '@/services/settingsOptions';

export function AddEscalationPage() {
  const navigate = useNavigate();
  const [options, setOptions] = useState<WorkspaceOptions>(fallbackOptions);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWorkspaceOptions()
      .then(setOptions)
      .finally(() => setLoading(false));
  }, []);

  const save = async (values: EscalationFormValues, attachments: EscalationFormAttachments) => {
    const created = await createEscalation(values);
    if (attachments.estimatePhotos.length) await uploadEscalationAttachments(created.id, attachments.estimatePhotos, 'estimate');
    if (attachments.moreInfoScreenshots.length) await uploadEscalationAttachments(created.id, attachments.moreInfoScreenshots, 'needs_more_info');
    navigate(`/escalations/${created.id}`);
  };

  const saveAndAddAnother = async (values: EscalationFormValues, attachments: EscalationFormAttachments) => {
    const created = await createEscalation(values);
    if (attachments.estimatePhotos.length) await uploadEscalationAttachments(created.id, attachments.estimatePhotos, 'estimate');
    if (attachments.moreInfoScreenshots.length) await uploadEscalationAttachments(created.id, attachments.moreInfoScreenshots, 'needs_more_info');
  };

  return (
    <div className="page-shell">
      <div className="mb-6">
        <p className="section-title">Carl workflow</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Add Escalation</h1>
        <p className="mt-2 text-sm text-slate-500">Use this for items from Quo, HomeWorks texts, and Gmail team@ that require owner direction.</p>
      </div>
      {loading ? <LoadingState label="Loading form options..." /> : <EscalationForm sources={options.sources} topics={options.topics} statuses={options.statuses} onSubmit={save} onSubmitAndAddAnother={saveAndAddAnother} />}
    </div>
  );
}
