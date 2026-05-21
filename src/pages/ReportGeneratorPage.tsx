import { useEffect, useMemo, useState } from 'react';
import { Clipboard, Save } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { LoadingState } from '@/components/common/LoadingState';
import { listEscalations } from '@/services/escalations';
import { saveReport } from '@/services/reports';
import { generateSodEodReport } from '@/utils/reports';
import { toInputDate } from '@/lib/utils';
import type { Escalation, ReportType } from '@/types';

export function ReportGeneratorPage() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [reportType, setReportType] = useState<ReportType>('SOD');
  const [date, setDate] = useState(toInputDate());
  const [include, setInclude] = useState('All unresolved');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    listEscalations({ resolved: false })
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load escalations.'))
      .finally(() => setLoading(false));
  }, []);

  const selectedItems = useMemo(() => {
    if (include === 'Urgent only') return items.filter((item) => item.urgency === 'Urgent / Customer-Sensitive');
    if (include === 'Standard only') return items.filter((item) => item.urgency === 'Standard / Non-Urgent');
    return items;
  }, [items, include]);

  const output = useMemo(() => generateSodEodReport(reportType, date, selectedItems), [reportType, date, selectedItems]);

  const copy = async () => {
    await navigator.clipboard.writeText(output);
    setMessage('Report copied to clipboard.');
  };

  const save = async () => {
    setMessage('');
    setError('');
    try {
      await saveReport(reportType, date, output);
      setMessage('Report saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save report.');
    }
  };

  return (
    <div className="page-shell space-y-6">
      <div>
        <p className="section-title">Carl reporting</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">SOD / EOD Generator</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">Generate a clean Bradley-ready report using current unresolved escalations.</p>
      </div>

      {loading ? <LoadingState label="Loading open escalations..." /> : (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Report Settings</CardTitle>
              <CardDescription>Select report type, date, and included items.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {message ? <Alert>{message}</Alert> : null}
              {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
              <div>
                <Label>Report Type</Label>
                <Select options={['SOD', 'EOD']} value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)} />
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </div>
              <div>
                <Label>Include</Label>
                <Select options={['All unresolved', 'Open escalations', 'Urgent only', 'Standard only']} value={include} onChange={(event) => setInclude(event.target.value)} />
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <Button onClick={copy} leftIcon={<Clipboard className="h-4 w-4" />}>Copy to Clipboard</Button>
                <Button variant="secondary" onClick={save} leftIcon={<Save className="h-4 w-4" />}>Save Report</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>{selectedItems.length} unresolved item(s) included.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-950 p-5 text-sm leading-6 text-slate-100">{output}</pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
