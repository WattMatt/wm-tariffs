import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";

interface UserWithRole {
  id: string;
  full_name: string;
  profiles: { full_name: string } | null;
  user_roles: { role: string }[];
}

export default function Users() {
  const [users, setUsers] = useState<UserWithRole[]>([]);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    // Fetch all profiles with their roles
    const { data, error } = await supabase
      .from("profiles")
      .select(`
        id,
        full_name,
        user_roles(role)
      `);

    if (error) {
      toast.error("Failed to fetch users");
    } else {
      setUsers(data as any || []);
    }
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case "admin":
        return "default";
      case "auditor":
        return "secondary";
      case "operator":
        return "outline";
      default:
        return "outline";
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-4xl font-bold mb-2">Users</h1>
          <p className="text-muted-foreground">
            View all system users and their roles
          </p>
        </div>

        {users.length === 0 ? (
          <Card className="border-border/50">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <UsersIcon className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No users found</h3>
              <p className="text-muted-foreground">Users will appear here once they sign up</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/50">
            <CardHeader>
              <CardTitle>All Users</CardTitle>
              <CardDescription>{users.length} user{users.length !== 1 ? 's' : ''} in the system</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>Roles</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.full_name}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{user.id}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {user.user_roles && user.user_roles.length > 0 ? (
                            user.user_roles.map((roleObj, idx) => (
                              <Badge key={idx} variant={getRoleBadgeVariant(roleObj.role) as any}>
                                {roleObj.role}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-muted-foreground">No roles assigned</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card className="border-border/50 bg-muted/20">
          <CardHeader>
            <CardTitle className="text-base">Role Permissions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              <Badge>admin</Badge>
              <span className="text-muted-foreground">Full system access, can manage clients, sites, meters, and users</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="secondary">auditor</Badge>
              <span className="text-muted-foreground">View-only access to all data and audit logs</span>
            </div>
            <div className="flex items-start gap-2">
              <Badge variant="outline">operator</Badge>
              <span className="text-muted-foreground">Can upload meter data and manage meters</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
