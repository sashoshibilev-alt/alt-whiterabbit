import { useState } from 'react';
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { V0_INITIATIVE_STATUS_LABELS, V0InitiativeStatus } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar, Target, Plus, Loader2 } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';

export default function V0InitiativesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const initiatives = useQuery(api.v0Initiatives.list);
  const createInitiative = useMutation(api.v0Initiatives.create);
  
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const getStatusColor = (status: V0InitiativeStatus) => {
    switch (status) {
      case "draft":
        return "bg-gray-500";
      case "active":
        return "bg-blue-500";
      case "done":
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  };

  const handleCreate = async () => {
    if (!newTitle.trim()) return;
    
    setIsCreating(true);
    try {
      const id = await createInitiative({
        title: newTitle.trim(),
        description: newDescription.trim(),
        status: "active",
      });
      toast({
        title: "Initiative created",
        description: "Your new initiative has been created",
      });
      setCreateModalOpen(false);
      setNewTitle("");
      setNewDescription("");
      navigate(`/initiatives/${id}`);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create initiative",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  if (initiatives === undefined) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Group by status
  const activeInitiatives = initiatives.filter(i => i.status === "active");
  const draftInitiatives = initiatives.filter(i => i.status === "draft");
  const doneInitiatives = initiatives.filter(i => i.status === "done");

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6" />
            Initiatives
          </h1>
          <p className="text-muted-foreground">Track work items linked from applied suggestions</p>
        </div>
        <Button onClick={() => setCreateModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Initiative
        </Button>
      </div>

      {initiatives.length === 0 ? (
        <Card className="flex-1 flex items-center justify-center">
          <CardContent className="text-center py-12">
            <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-medium mb-2">No initiatives yet</h3>
            <p className="text-muted-foreground mb-4">
              Initiatives are created when you apply suggestions from meeting notes.
            </p>
            <Button onClick={() => setCreateModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create your first initiative
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6 flex-1 overflow-auto">
          {/* Active Initiatives */}
          {activeInitiatives.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Badge className="bg-blue-500">Active</Badge>
                  <span>({activeInitiatives.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeInitiatives.map(initiative => (
                      <TableRow 
                        key={initiative._id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/initiatives/${initiative._id}`)}
                      >
                        <TableCell className="font-medium">{initiative.title}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            {format(initiative.createdAt, "MMM d, yyyy")}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(initiative.updatedAt, { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Draft Initiatives */}
          {draftInitiatives.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Badge className="bg-gray-500">Draft</Badge>
                  <span>({draftInitiatives.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draftInitiatives.map(initiative => (
                      <TableRow 
                        key={initiative._id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/initiatives/${initiative._id}`)}
                      >
                        <TableCell className="font-medium">{initiative.title}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            {format(initiative.createdAt, "MMM d, yyyy")}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(initiative.updatedAt, { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Done Initiatives */}
          {doneInitiatives.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Badge className="bg-green-500">Done</Badge>
                  <span>({doneInitiatives.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {doneInitiatives.map(initiative => (
                      <TableRow 
                        key={initiative._id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/initiatives/${initiative._id}`)}
                      >
                        <TableCell className="font-medium">{initiative.title}</TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            {format(initiative.createdAt, "MMM d, yyyy")}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(initiative.updatedAt, { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Create Initiative Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Initiative</DialogTitle>
            <DialogDescription>
              Create a new initiative to track related work items
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Initiative title..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="What is this initiative about?"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isCreating || !newTitle.trim()}>
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
