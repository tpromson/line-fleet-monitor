import { useEffect, useState, type ChangeEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { fetchBackend } from '@/lib/backend-api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface OrgRow {
  id: string
  name: string
  created_at: string
}

interface ProviderRow {
  id: string
  name: string
  organization: { id: string; name: string }
}

interface ChannelRow {
  id: string
  channel_name: string
  channel_id: string
  quota_limit: number
  active: boolean
  provider: { id: string; name: string }
}

interface ChannelForm {
  provider_id: string
  channel_name: string
  channel_id: string
  channel_secret: string
  access_token: string
  quota_limit: string
}

const emptyForm: ChannelForm = {
  provider_id: '',
  channel_name: '',
  channel_id: '',
  channel_secret: '',
  access_token: '',
  quota_limit: '500',
}

export function SetupPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Setup</h2>
        <p className="text-muted-foreground">Manage organizations, providers, and channels</p>
      </div>

      <Tabs defaultValue="organizations">
        <TabsList>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent value="organizations" className="mt-4">
          <OrgManager />
        </TabsContent>
        <TabsContent value="providers" className="mt-4">
          <ProviderManager />
        </TabsContent>
        <TabsContent value="channels" className="mt-4">
          <ChannelManager />
        </TabsContent>
        <TabsContent value="members" className="mt-4">
          <OrgMembersManager />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function OrgManager() {
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('organizations').select('id, name, created_at').order('name')
    setOrgs(data ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    if (!name.trim()) return
    await supabase.from('organizations').insert({ name: name.trim() })
    setName('')
    setOpen(false)
    load()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Organizations</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button size="sm">Add Organization</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Organization</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="org-name">Name</Label>
              <Input id="org-name" value={name} onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="My Organization" />
            </div>
            <Button onClick={create} disabled={!name.trim()}>Create</Button>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : orgs.length === 0 ? (
          <p className="text-center py-4 text-muted-foreground">No organizations yet</p>
        ) : (
          <div className="space-y-1">
            {orgs.map((org) => (
              <div key={org.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <span className="text-sm font-medium">{org.name}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(org.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProviderManager() {
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [orgId, setOrgId] = useState('')
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editOrgId, setEditOrgId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editError, setEditError] = useState('')

  const load = async () => {
    setLoading(true)
    const [provsRes, orgsRes] = await Promise.all([
      supabase.from('providers').select('id, name, organization:organization_id(id, name)').order('name'),
      supabase.from('organizations').select('id, name, created_at').order('name'),
    ])

    if (provsRes.error) console.error('providers fetch error:', provsRes.error)
    if (orgsRes.error) console.error('orgs fetch error:', orgsRes.error)

    if (provsRes.data) {
      setProviders(
        (provsRes.data as any[]).map((p) => ({
          id: p.id,
          name: p.name,
          organization: Array.isArray(p.organization) ? p.organization[0] : p.organization,
        }))
      )
    }
    if (orgsRes.data) setOrgs(orgsRes.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    if (!name.trim() || !orgId) return
    setError('')
    const { error: err } = await supabase.from('providers').insert({ name: name.trim(), organization_id: orgId })
    if (err) { setError(err.message); return }
    setName('')
    setOpen(false)
    setError('')
    load()
  }

  const openEditDialog = (p: ProviderRow) => {
    setEditingId(p.id)
    setEditName(p.name)
    setEditOrgId(p.organization.id)
    setEditError('')
    setEditOpen(true)
  }

  const saveEdit = async () => {
    if (!editName.trim() || !editingId) return
    setEditError('')
    const { error: err } = await supabase.from('providers').update({
      name: editName.trim(),
      organization_id: editOrgId,
    }).eq('id', editingId)
    if (err) { setEditError(err.message); return }
    setEditOpen(false)
    setEditingId(null)
    load()
  }

  const deleteProvider = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This will also delete all channels under it.`)) return
    await supabase.from('providers').delete().eq('id', id)
    load()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Providers</CardTitle>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Provider</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="editp-name">Name</Label>
                <Input id="editp-name" value={editName} onChange={(e: ChangeEvent<HTMLInputElement>) => setEditName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editp-org">Organization</Label>
                <select
                  id="editp-org"
                  value={editOrgId}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setEditOrgId(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                >
                  <option value="">Select...</option>
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <Button onClick={saveEdit} disabled={!editName.trim() || !editOrgId}>Save</Button>
          </DialogContent>
        </Dialog>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button size="sm">Add Provider</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Provider</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="prov-name">Name</Label>
                <Input id="prov-name" value={name} onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)} placeholder="Production Provider" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prov-org">Organization</Label>
                <select
                  id="prov-org"
                  value={orgId}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setOrgId(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                >
                  <option value="">Select...</option>
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={create} disabled={!name.trim() || !orgId}>Create</Button>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : providers.length === 0 ? (
          <p className="text-center py-4 text-muted-foreground">No providers yet</p>
        ) : (
          <div className="space-y-1">
            {providers.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <span className="text-sm font-medium">{p.name}</span>
                  <p className="text-xs text-muted-foreground">{p.organization.name}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => openEditDialog(p)}>Edit</Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteProvider(p.id, p.name)}>Del</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function OrgMembersManager() {
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [selectedOrg, setSelectedOrg] = useState('')
  const [members, setMembers] = useState<{ id: string; user_id: string; email: string; role: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('organizations').select('id, name, created_at').order('name').then(({ data }) => {
      if (data) setOrgs(data)
    })
  }, [])

  const loadMembers = async (orgId: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('organization_members')
      .select('id, user_id, role')
      .eq('organization_id', orgId)

    if (data) {
      const enriched = await Promise.all(
        data.map(async (m) => {
          const email = await fetchUserEmail(m.user_id)
          return { ...m, email }
        })
      )
      setMembers(enriched)
    } else {
      setMembers([])
    }
    setLoading(false)
  }

  const fetchUserEmail = async (userId: string): Promise<string> => {
    try {
      const res = await fetchBackend(`/api/users/lookup?id=${userId}`)
      if (res.ok) {
        const data = await res.json()
        return data.email ?? userId.slice(0, 8) + '...'
      }
    } catch { /* fall through to truncated ID below */ }
    return userId.slice(0, 8) + '...'
  }
  }

  useEffect(() => {
    if (selectedOrg) loadMembers(selectedOrg)
  }, [selectedOrg])

  const addMember = async () => {
    if (!email.trim() || !selectedOrg) return
    setError('')

    try {
      const res = await fetchBackend(`/api/users/lookup?email=${encodeURIComponent(email.trim())}`)
      if (!res.ok) { setError('User not found'); return }
      const user = await res.json()

      const { error: err } = await supabase.from('organization_members').insert({
        user_id: user.id,
        organization_id: selectedOrg,
        role,
      })
      if (err) { setError(err.message); return }

      setEmail('')
      loadMembers(selectedOrg)
    } catch {
      setError('Cannot reach backend')
    }
  }

  const removeMember = async (id: string) => {
    await supabase.from('organization_members').delete().eq('id', id)
    loadMembers(selectedOrg)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization Members</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="member-org">Organization</Label>
          <select
            id="member-org"
            value={selectedOrg}
            onChange={(e) => setSelectedOrg(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          >
            <option value="">Select...</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>

        {selectedOrg && (
          <>
            <div className="flex gap-2">
              <Input
                placeholder="user@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="flex-1"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="border rounded-md px-2 py-1 text-sm bg-background"
              >
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
              <Button size="sm" onClick={addMember}>Add</Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}

            {loading ? (
              <Skeleton className="h-16 w-full" />
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members</p>
            ) : (
              <div className="space-y-1">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <span className="text-sm">{m.email}</span>
                      <Badge variant="outline" className="ml-2 text-xs">{m.role}</Badge>
                    </div>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => removeMember(m.id)}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ChannelManager() {
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [providers, setProviders] = useState<ProviderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ChannelForm>(emptyForm)
  const [editError, setEditError] = useState('')
  const [createError, setCreateError] = useState('')

  const load = async () => {
    setLoading(true)
    const [chsRes, provsRes] = await Promise.all([
      supabase.from('channels').select('id, channel_name, channel_id, quota_limit, active, provider:provider_id(id, name)').order('channel_name'),
      supabase.from('providers').select('id, name, organization:organization_id(id, name)').order('name'),
    ])

    if (chsRes.data) {
      setChannels(
        (chsRes.data as any[]).map((c) => ({
          id: c.id,
          channel_name: c.channel_name,
          channel_id: c.channel_id,
          quota_limit: c.quota_limit,
          active: c.active,
          provider: Array.isArray(c.provider) ? c.provider[0] : c.provider,
        }))
      )
    }
    if (provsRes.data) {
      setProviders(
        (provsRes.data as any[]).map((p) => ({
          id: p.id,
          name: p.name,
          organization: Array.isArray(p.organization) ? p.organization[0] : p.organization,
        }))
      )
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    if (!form.channel_name.trim() || !form.channel_secret.trim() || !form.access_token.trim() || !form.provider_id) return
    setCreateError('')
    const { error: err } = await supabase.from('channels').insert({
      provider_id: form.provider_id,
      channel_name: form.channel_name.trim(),
      channel_id: form.channel_id.trim(),
      channel_secret: form.channel_secret.trim(),
      access_token: form.access_token.trim(),
      quota_limit: parseInt(form.quota_limit) || 300,
    })
    if (err) { setCreateError(err.message); return }
    setForm(emptyForm)
    setOpen(false)
    setCreateError('')
    load()
  }

  const openEdit = (c: ChannelRow) => {
    setEditingId(c.id)
    setForm({
      provider_id: c.provider.id,
      channel_name: c.channel_name,
      channel_id: c.channel_id,
      channel_secret: '',
      access_token: '',
      quota_limit: String(c.quota_limit),
    })
    setEditError('')
    setEditOpen(true)
  }

  const saveEdit = async () => {
    if (!form.channel_name.trim() || !editingId) return
    setEditError('')
    const updateData: any = {
      provider_id: form.provider_id,
      channel_name: form.channel_name.trim(),
      channel_id: form.channel_id.trim(),
      quota_limit: parseInt(form.quota_limit) || 300,
    }
    if (form.channel_secret.trim()) updateData.channel_secret = form.channel_secret.trim()
    if (form.access_token.trim()) updateData.access_token = form.access_token.trim()

    const { error: err } = await supabase.from('channels').update(updateData).eq('id', editingId)
    if (err) { setEditError(err.message); return }
    setEditOpen(false)
    setEditingId(null)
    load()
  }

  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from('channels').update({ active: !active }).eq('id', id)
    load()
  }

  const deleteChannel = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    await supabase.from('channels').delete().eq('id', id)
    load()
  }

  const updateField = (field: keyof ChannelForm) => (e: ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [field]: e.target.value })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Channels</CardTitle>

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Channel</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="edit-prov">Provider</Label>
                <select
                  id="edit-prov"
                  value={form.provider_id}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setForm({ ...form, provider_id: e.target.value })}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                >
                  <option value="">Select...</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.organization.name})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-name">Channel Name</Label>
                <Input id="edit-name" value={form.channel_name} onChange={updateField('channel_name')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-ch-id">Channel ID</Label>
                <Input id="edit-ch-id" value={form.channel_id} onChange={updateField('channel_id')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-secret">Channel Secret</Label>
                <Input id="edit-secret" type="password" value={form.channel_secret} onChange={updateField('channel_secret')} placeholder="Leave blank to keep current" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-token">Access Token</Label>
                <Input id="edit-token" type="password" value={form.access_token} onChange={updateField('access_token')} placeholder="Leave blank to keep current" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-limit">Quota Limit</Label>
                <Input id="edit-limit" type="number" value={form.quota_limit} onChange={updateField('quota_limit')} />
              </div>
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
            <Button onClick={saveEdit} disabled={!form.channel_name || !form.provider_id}>
              Save Changes
            </Button>
          </DialogContent>
        </Dialog>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger>
            <Button size="sm">Add Channel</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>New Channel</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="ch-provider">Provider</Label>
                <select
                  id="ch-provider"
                  value={form.provider_id}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setForm({ ...form, provider_id: e.target.value })}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                >
                  <option value="">Select...</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.organization.name})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ch-name">Channel Name</Label>
                <Input id="ch-name" value={form.channel_name} onChange={updateField('channel_name')} placeholder="OPD BOT" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ch-id">Channel ID</Label>
                <Input id="ch-id" value={form.channel_id} onChange={updateField('channel_id')} placeholder="1655xxxxxx" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ch-secret">Channel Secret</Label>
                <Input id="ch-secret" type="password" value={form.channel_secret} onChange={updateField('channel_secret')} placeholder="xxxxxxxx" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ch-token">Access Token</Label>
                <Input id="ch-token" type="password" value={form.access_token} onChange={updateField('access_token')} placeholder="xxxxxxxx" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ch-limit">Quota Limit</Label>
                <Input id="ch-limit" type="number" value={form.quota_limit} onChange={updateField('quota_limit')} />
              </div>
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <Button onClick={create} disabled={!form.channel_name || !form.access_token || !form.provider_id}>
              Create
            </Button>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : channels.length === 0 ? (
          <p className="text-center py-4 text-muted-foreground">No channels yet</p>
        ) : (
          <div className="space-y-1">
            {channels.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <span className="text-sm font-medium">{c.channel_name}</span>
                  <p className="text-xs text-muted-foreground">
                    {c.provider.name} &middot; {c.channel_id} &middot; Limit: {c.quota_limit.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={c.active ? 'default' : 'outline'}>
                    {c.active ? 'Active' : 'Paused'}
                  </Badge>
                  <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleActive(c.id, c.active)}>
                    {c.active ? 'Pause' : 'Activate'}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteChannel(c.id, c.channel_name)}>
                    Del
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
