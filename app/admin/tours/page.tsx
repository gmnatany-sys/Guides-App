import { createClient } from '@/lib/supabase/server'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PermissionGate } from '@/components/permission-gate'
import type { Tour } from '@/lib/types'

async function ToursContent() {
  const supabase = await createClient()
  const { data: tours, error } = await supabase
    .from('tours')
    .select('*')
    .order('name', { ascending: true })

  if (error) {
    return (
      <div className="text-destructive">
        Error loading tours: {error.message}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Tours</h1>
        <p className="text-muted-foreground">
          View all available tours in the system.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Tours</CardTitle>
        </CardHeader>
        <CardContent>
          {tours && tours.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(tours as Tour[]).map((tour) => (
                  <TableRow key={tour.id}>
                    <TableCell className="font-medium">{tour.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {tour.description || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(tour.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No tours found. Add tours to your database to see them here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ToursPage() {
  return (
    <PermissionGate permissions={['tours_manage_access']}>
      <ToursContent />
    </PermissionGate>
  )
}
