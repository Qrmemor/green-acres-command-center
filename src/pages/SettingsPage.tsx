import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { LoadingState } from '@/components/common/LoadingState';
import { createWorkspaceOption, deleteWorkspaceOption, getAllWorkspaceOptions, updateWorkspaceOption } from '@/services/settingsOptions';
import { listProfiles, updateProfileRole } from '@/services/profiles';
import type { Role, UserProfile, WorkspaceOption } from '@/types';

const categories: WorkspaceOption['category'][] = ['source', 'topic', 'status'];
const roles: Role[] = ['carl', 'bradley', 'admin'];

export function SettingsPage() {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [options, setOptions] = useState<WorkspaceOption[]>([]);
  const [category, setCategory] = useState<WorkspaceOption['category']>('source');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextProfiles, nextOptions] = await Promise.all([listProfiles(), getAllWorkspaceOptions()]);
      setProfiles(nextProfiles);
      setOptions(nextOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(
    () => categories.map((item) => ({ category: item, options: options.filter((option) => option.category === item) })),
    [options]
  );

  const addOption = async (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    setMessage('');
    setError('');
    try {
      await createWorkspaceOption(category, label.trim());
      setLabel('');
      setMessage('Option added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add option.');
    }
  };

  const toggleOption = async (option: WorkspaceOption) => {
    await updateWorkspaceOption(option.id, { is_active: !option.is_active });
    await load();
  };

  const removeOption = async (id: string) => {
    const confirmed = window.confirm('Delete this option? Existing escalations keep their current text value.');
    if (!confirmed) return;
    await deleteWorkspaceOption(id);
    await load();
  };

  const changeRole = async (id: string, role: Role) => {
    await updateProfileRole(id, role);
    await load();
  };

  return (
    <div className="page-shell space-y-6">
      <div>
        <p className="section-title">Workspace controls</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">Manage users plus source, topic, and status options used across escalation forms and filters.</p>
      </div>

      {loading ? <LoadingState label="Loading settings..." /> : (
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <div className="space-y-6">
            {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
            {message ? <div className="rounded-2xl border border-ga-200 bg-ga-50 p-4 text-sm text-ga-800">{message}</div> : null}

            <Card>
              <CardHeader>
                <CardTitle>Users</CardTitle>
                <CardDescription>Roles control how the team is identified in the app. Supabase Auth still manages passwords.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-3 pr-3">Name</th>
                        <th className="py-3 pr-3">Email</th>
                        <th className="py-3 pr-3">Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profiles.map((profile) => (
                        <tr key={profile.id} className="border-b border-slate-100 last:border-0">
                          <td className="py-3 pr-3 font-medium text-slate-900">{profile.full_name ?? 'No name'}</td>
                          <td className="py-3 pr-3 text-slate-600">{profile.email}</td>
                          <td className="py-3 pr-3">
                            <Select options={roles} value={profile.role} onChange={(event) => changeRole(profile.id, event.target.value as Role)} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Options</CardTitle>
                <CardDescription>Active options show in forms and filters. Deactivate instead of deleting when possible.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {grouped.map((group) => (
                  <div key={group.category}>
                    <h3 className="mb-2 text-sm font-semibold capitalize text-slate-900">{group.category} options</h3>
                    <div className="space-y-2">
                      {group.options.map((option) => (
                        <div key={option.id} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
                          <Input value={option.label} onChange={(event) => updateWorkspaceOption(option.id, { label: event.target.value }).then(load)} />
                          <Button variant={option.is_active ? 'secondary' : 'ghost'} onClick={() => toggleOption(option)}>
                            {option.is_active ? 'Active' : 'Inactive'}
                          </Button>
                          <Button variant="ghost" onClick={() => removeOption(option.id)} leftIcon={<Trash2 className="h-4 w-4" />}>
                            Delete
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Add Option</CardTitle>
              <CardDescription>Add a source, topic, or status option for Carl’s workflow.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={addOption} className="space-y-4">
                <div>
                  <Label>Category</Label>
                  <Select options={categories} value={category} onChange={(event) => setCategory(event.target.value as WorkspaceOption['category'])} />
                </div>
                <div>
                  <Label>Label</Label>
                  <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="New option label" />
                </div>
                <Button type="submit" leftIcon={<Plus className="h-4 w-4" />}>Add Option</Button>
              </form>

              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="mb-2 flex items-center gap-2 font-semibold"><Save className="h-4 w-4" /> Setup note</div>
                Create users in Supabase Auth first. The SQL trigger creates their profile automatically after signup or admin-created user creation.
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
