'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { 
  fetchAppUsers, 
  createAppUser, 
  updateAppUser, 
  toggleUserActive,
  deleteAppUser,
  fetchUserPermissions,
  updateUserPermission,
  type AppUser,
  type UserPermission
} from './actions'

// Client-only date formatter to avoid hydration mismatch
function FormattedDate({ dateString }: { dateString: string }) {
  const [formatted, setFormatted] = useState<string>('')
  
  useEffect(() => {
    setFormatted(new Date(dateString).toLocaleDateString())
  }, [dateString])
  
  // Return empty string on server, formatted date after client mount
  if (!formatted) return null
  return <>{formatted}</>
}

// Define ROLES and PERMISSIONS in client component to avoid serialization issues
const ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'operation', label: 'Operation' },
  { value: 'agent', label: 'Agent' },
  { value: 'supplier', label: 'Supplier' },
]

// Grouped permissions by section
const PERMISSION_GROUPS = [
  {
    section: 'Supplier',
    permissions: [
      { key: 'supplier_confirmation_view', label: 'Can view Supplier Confirmation' },
      { key: 'supplier_confirmation_action', label: 'Can perform actions in Supplier Confirmation' },
    ]
  },
  {
    section: 'Booking',
    permissions: [
      { key: 'booking_form_access', label: 'Can view and submit bookings in Booking Form' },
    ]
  },
  {
    section: 'Users',
    permissions: [
      { key: 'users_manage_access', label: 'Can view and manage Users' },
    ]
  },
  {
    section: 'Email',
    permissions: [
      { key: 'email_logs_view_access', label: 'Can view Email Logs' },
    ]
  },
  {
    section: 'Reservations',
    permissions: [
      { key: 'reservations_view_access', label: 'Can view Reservations Management' },
      { key: 'reservations_search_access', label: 'Can search in Reservations Management' },
      { key: 'reservations_action_access', label: 'Can perform actions in Reservations Management' },
    ]
  },
  {
    section: 'Availability',
    permissions: [
      { key: 'availability_view_access', label: 'Can view Availability Calendar View' },
      { key: 'availability_calendar_manage_access', label: 'Can view and perform actions in Availability Calendar' },
      { key: 'open_dates_view_access', label: 'Can view Open Dates' },
    ]
  },
  {
    section: 'Minimum Participants',
    permissions: [
      { key: 'minimum_participants_view_access', label: 'Can view Minimum Participants' },
      { key: 'minimum_participants_action_access', label: 'Can perform actions in Minimum Participants' },
    ]
  },
  {
    section: 'Tours',
    permissions: [
      { key: 'tours_manage_access', label: 'Can view and perform actions in Tours' },
    ]
  },
]

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: 'Full system access',
  operation: 'Manage bookings, reservations, and day-to-day operations',
  agent: 'Travel agent - can create bookings',
  supplier: 'Tour supplier and guides - view availability and confirmations',
}

function getRoleBadgeColor(role: string) {
  switch (role) {
    case 'admin': return 'bg-purple-100 text-purple-800'
    case 'operation': return 'bg-green-100 text-green-800'
    case 'agent': return 'bg-orange-100 text-orange-800'
    case 'supplier': return 'bg-gray-100 text-gray-800'
    default: return 'bg-gray-100 text-gray-800'
  }
}

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  
  // Filters
  const [roleFilter, setRoleFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('all')
  const [searchFilter, setSearchFilter] = useState('')
  
  // Dialog state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AppUser | null>(null)
  const [deletingUser, setDeletingUser] = useState<AppUser | null>(null)
  
  // Permissions state
  const [permissionsUser, setPermissionsUser] = useState<AppUser | null>(null)
  const [userPermissions, setUserPermissions] = useState<UserPermission[]>([])
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(false)

  // Guards the initial fetch against React 18 Strict Mode double-invocation.
  // Strict Mode unmounts + remounts effects in dev, which would fire two concurrent
  // fetchAppUsers() calls on mount without this guard.
  const didInitialLoad = useRef(false)

  async function loadUsers() {
    setIsLoading(true)
    const filters: { role?: string; active?: boolean; search?: string } = {}
    
    if (roleFilter !== 'all') filters.role = roleFilter
    if (activeFilter !== 'all') filters.active = activeFilter === 'active'
    if (searchFilter.trim()) filters.search = searchFilter
    
    try {
      const { users: data, error } = await fetchAppUsers(filters)
      if (error) {
        setMessage({ type: 'error', text: error })
      } else {
        setUsers(data)
      }
    } catch (err) {
      console.error('[v0] users loadUsers failed:', err)
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to load users.' })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (didInitialLoad.current) return
    didInitialLoad.current = true
    loadUsers()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleApplyFilters() {
    loadUsers()
  }

  function handleClearFilters() {
    setRoleFilter('all')
    setActiveFilter('all')
    setSearchFilter('')
    startTransition(async () => {
      const { users: data } = await fetchAppUsers()
      setUsers(data)
    })
  }

  async function handleCreateUser(formData: FormData) {
    setMessage(null)
    startTransition(async () => {
      const result = await createAppUser(formData)
      if (result.success) {
        setMessage({ type: 'success', text: 'User created successfully.' })
        setIsCreateOpen(false)
        loadUsers()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to create user.' })
      }
    })
  }

  async function handleUpdateUser(formData: FormData) {
    if (!editingUser) return
    setMessage(null)
    startTransition(async () => {
      const result = await updateAppUser(editingUser.id, formData)
      if (result.success) {
        setMessage({ type: 'success', text: 'User updated successfully.' })
        setEditingUser(null)
        loadUsers()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update user.' })
      }
    })
  }

  async function handleToggleActive(user: AppUser) {
    startTransition(async () => {
      const result = await toggleUserActive(user.id, !user.active)
      if (result.success) {
        setMessage({ type: 'success', text: `User ${user.active ? 'deactivated' : 'activated'} successfully.` })
        loadUsers()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update user.' })
      }
    })
  }

  async function handleDeleteUser() {
    if (!deletingUser) return
    startTransition(async () => {
      const result = await deleteAppUser(deletingUser.id)
      if (result.success) {
        setMessage({ type: 'success', text: 'User deleted successfully.' })
        setDeletingUser(null)
        loadUsers()
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to delete user.' })
      }
    })
  }

  async function handleOpenPermissions(user: AppUser) {
    setPermissionsUser(user)
    setIsLoadingPermissions(true)
    const { permissions } = await fetchUserPermissions(user.id)
    setUserPermissions(permissions)
    setIsLoadingPermissions(false)
  }

  async function handleTogglePermission(permissionKey: string, enabled: boolean) {
    if (!permissionsUser) return
    startTransition(async () => {
      const result = await updateUserPermission(permissionsUser.id, permissionKey, enabled)
      if (result.success) {
        // Update local state
        setUserPermissions(prev => {
          const existing = prev.find(p => p.permission_key === permissionKey)
          if (existing) {
            return prev.map(p => p.permission_key === permissionKey ? { ...p, enabled } : p)
          } else {
            return [...prev, { id: '', user_id: permissionsUser.id, permission_key: permissionKey, enabled }]
          }
        })
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to update permission.' })
      }
    })
  }

  function isPermissionEnabled(permissionKey: string): boolean {
    const permission = userPermissions.find(p => p.permission_key === permissionKey)
    return permission?.enabled ?? false
  }

  return (
    <main className="flex-1 p-6 overflow-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Users ({users.length})</CardTitle>
              <CardDescription>Manage agents, operators, and suppliers who can access the system.</CardDescription>
            </div>
            <Button onClick={() => setIsCreateOpen(true)}>Add User</Button>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New User</DialogTitle>
                </DialogHeader>
                <form action={handleCreateUser} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="full_name">Full Name *</Label>
                    <Input id="full_name" name="full_name" placeholder="John Smith" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input id="email" name="email" type="email" placeholder="john@example.com" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="role">Role *</Label>
                    <Select name="role" required>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map(role => (
                          <SelectItem key={role.value} value={role.value}>
                            <div className="flex flex-col">
                              <span>{role.label}</span>
                              <span className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role.value]}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={isPending}>
                      {isPending ? 'Creating...' : 'Create User'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <div className={`p-3 rounded-md text-sm ${
              message.type === 'success' 
                ? 'bg-green-50 text-green-800 border border-green-200' 
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {message.text}
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-4 items-end p-4 bg-slate-50 rounded-lg">
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  {ROLES.map(role => (
                    <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 flex-1 min-w-[200px]">
              <Label>Search by name or email</Label>
              <Input 
                placeholder="Enter search term..." 
                value={searchFilter} 
                onChange={(e) => setSearchFilter(e.target.value)} 
              />
            </div>
            <Button onClick={handleApplyFilters} disabled={isPending}>Apply</Button>
            <Button variant="outline" onClick={handleClearFilters} disabled={isPending}>Clear</Button>
          </div>

          {/* Users Table */}
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading users...</div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No users found. Add your first user above.</div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.full_name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>
                        <Badge className={getRoleBadgeColor(user.role)}>
                          {ROLES.find(r => r.value === user.role)?.label || user.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.active ? 'default' : 'secondary'}>
                          {user.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <FormattedDate dateString={user.created_at} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleOpenPermissions(user)}
                          >
                            Permissions
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setEditingUser(user)}
                          >
                            Edit
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => handleToggleActive(user)}
                            disabled={isPending}
                          >
                            {user.active ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button 
                            variant="destructive" 
                            size="sm"
                            onClick={() => setDeletingUser(user)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editingUser && (
            <form action={handleUpdateUser} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit_full_name">Full Name *</Label>
                <Input 
                  id="edit_full_name" 
                  name="full_name" 
                  defaultValue={editingUser.full_name} 
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_email">Email *</Label>
                <Input 
                  id="edit_email" 
                  name="email" 
                  type="email" 
                  defaultValue={editingUser.email} 
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_role">Role *</Label>
                <Select name="role" defaultValue={editingUser.role}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map(role => (
                      <SelectItem key={role.value} value={role.value}>
                        {role.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center space-x-2">
                <Switch 
                  id="edit_active" 
                  name="active" 
                  defaultChecked={editingUser.active}
                  value="true"
                />
                <Label htmlFor="edit_active">Active</Label>
              </div>
              <input type="hidden" name="active" value={editingUser.active ? 'true' : 'false'} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
                <Button type="submit" disabled={isPending}>
                  {isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground">
            Are you sure you want to delete <strong>{deletingUser?.full_name}</strong>? 
            This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingUser(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={isPending}>
              {isPending ? 'Deleting...' : 'Delete User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permissions Dialog */}
      <Dialog open={!!permissionsUser} onOpenChange={(open) => !open && setPermissionsUser(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Permissions for {permissionsUser?.full_name}</DialogTitle>
          </DialogHeader>
          {isLoadingPermissions ? (
            <div className="py-8 text-center text-muted-foreground">Loading permissions...</div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Permissions control what the user can access. Role only sets default permissions when the user is created.
              </p>
              <div className="space-y-6">
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.section} className="space-y-2">
                    <h4 className="font-semibold text-sm text-slate-700 border-b pb-1">{group.section}</h4>
                    <div className="space-y-1">
                      {group.permissions.map((permission) => (
                        <div 
                          key={permission.key} 
                          className="flex items-center justify-between py-2 px-3 rounded hover:bg-slate-50"
                        >
                          <Label className="font-normal cursor-pointer">{permission.label}</Label>
                          <Switch
                            checked={isPermissionEnabled(permission.key)}
                            onCheckedChange={(checked) => handleTogglePermission(permission.key, checked)}
                            disabled={isPending}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setPermissionsUser(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
