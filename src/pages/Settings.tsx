import { useShipItStore } from '@/hooks/useShipItStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Video, FileText, GitBranch, Shield, Check, X, Info } from 'lucide-react';
import { ConvexExample } from '@/components/examples/ConvexExample';

export default function SettingsPage() {
  const { connections, toggleConnection } = useShipItStore();

  const meetingSources = connections.filter(c => c.type === 'meeting_source');
  const roadmapSystems = connections.filter(c => c.type === 'roadmap_system');

  const getIcon = (provider: string) => {
    switch (provider) {
      case 'granola': return <Video className="h-6 w-6" />;
      case 'gemini': return <FileText className="h-6 w-6" />;
      case 'linear': return <GitBranch className="h-6 w-6" />;
      default: return <FileText className="h-6 w-6" />;
    }
  };

  return (
    <div className="h-full overflow-auto p-6 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage connections and safety settings</p>
      </div>

      {/* Connections */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Meeting Notes Sources</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {meetingSources.map(connection => (
            <Card key={connection.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-lg ${connection.isConnected ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                      {getIcon(connection.provider)}
                    </div>
                    <div>
                      <h3 className="font-medium">{connection.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        {connection.isConnected ? (
                          <Badge variant="success" className="text-xs">
                            <Check className="h-3 w-3 mr-1" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <X className="h-3 w-3 mr-1" />
                            Disconnected
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button 
                    variant={connection.isConnected ? "outline" : "default"}
                    size="sm"
                    onClick={() => toggleConnection(connection.id)}
                  >
                    {connection.isConnected ? 'Disconnect' : 'Connect'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Roadmap Systems</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {roadmapSystems.map(connection => (
            <Card key={connection.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-lg ${connection.isConnected ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                      {getIcon(connection.provider)}
                    </div>
                    <div>
                      <h3 className="font-medium">{connection.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        {connection.isConnected ? (
                          <Badge variant="success" className="text-xs">
                            <Check className="h-3 w-3 mr-1" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            <X className="h-3 w-3 mr-1" />
                            Disconnected
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button 
                    variant={connection.isConnected ? "outline" : "default"}
                    size="sm"
                    onClick={() => toggleConnection(connection.id)}
                  >
                    {connection.isConnected ? 'Disconnect' : 'Connect'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <Separator className="my-8" />

      {/* Convex Integration Example */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4">Convex Integration</h2>
        <ConvexExample />
      </section>

      <Separator className="my-8" />

      {/* Safety Mode */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Safety Mode
        </h2>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="font-medium">Draft-only mode</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  All suggestions are drafts. Changes must be manually reviewed and applied.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={true} disabled />
                <Badge variant="outline" className="text-xs">Locked</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Alert className="mt-4">
          <Info className="h-4 w-4" />
          <AlertTitle>Prototype Safety</AlertTitle>
          <AlertDescription>
            This prototype never writes to external systems. All changes are stored locally 
            and can be reviewed before any future integration with real tools like Linear.
          </AlertDescription>
        </Alert>
      </section>
    </div>
  );
}
