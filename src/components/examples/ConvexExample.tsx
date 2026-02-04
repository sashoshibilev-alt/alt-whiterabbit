import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState } from "react";

/**
 * Example component demonstrating Convex integration
 * 
 * This component shows how to:
 * - Use useQuery to fetch data from Convex
 * - Use useMutation to create/update data
 * - Handle loading and error states
 */
export function ConvexExample() {
  // Query all initiatives from Convex
  const initiatives = useQuery(api.initiatives.list);
  
  // Mutation to create a new initiative
  const createInitiative = useMutation(api.initiatives.create);
  
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateExample = async () => {
    setIsCreating(true);
    try {
      await createInitiative({
        name: "Example Initiative from Convex",
        owner: "Demo User",
        status: "planned",
        releaseDate: new Date("2025-06-01").toISOString(),
        description: "This is an example initiative created using Convex mutations",
      });
    } catch (error) {
      console.error("Failed to create initiative:", error);
    } finally {
      setIsCreating(false);
    }
  };

  if (initiatives === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Convex Integration Example</CardTitle>
          <CardDescription>Loading initiatives from Convex...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convex Integration Example</CardTitle>
        <CardDescription>
          This component demonstrates how to use Convex queries and mutations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-semibold mb-2">Initiatives from Convex:</h3>
          {initiatives.length === 0 ? (
            <p className="text-sm text-muted-foreground">No initiatives found. Create one below!</p>
          ) : (
            <ul className="list-disc list-inside space-y-1">
              {initiatives.map((initiative) => (
                <li key={initiative._id} className="text-sm">
                  <strong>{initiative.name}</strong> - {initiative.status} (Owner: {initiative.owner})
                </li>
              ))}
            </ul>
          )}
        </div>
        
        <Button 
          onClick={handleCreateExample} 
          disabled={isCreating}
          className="w-full"
        >
          {isCreating ? "Creating..." : "Create Example Initiative"}
        </Button>
        
        <div className="text-xs text-muted-foreground pt-2 border-t">
          <p><strong>How it works:</strong></p>
          <ul className="list-disc list-inside space-y-1 mt-1">
            <li><code>useQuery(api.initiatives.list)</code> - Fetches data reactively</li>
            <li><code>useMutation(api.initiatives.create)</code> - Updates data</li>
            <li>Data automatically syncs across all connected clients</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
