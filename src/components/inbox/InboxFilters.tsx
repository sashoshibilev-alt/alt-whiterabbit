import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfidenceLevel, ChangeType, SuggestionStatus } from '@/types';
import { Filter, X } from 'lucide-react';

interface InboxFiltersProps {
  search: string;
  confidence: ConfidenceLevel | 'all';
  changeType: ChangeType | 'all';
  status: SuggestionStatus | 'all';
  onSearchChange: (value: string) => void;
  onConfidenceChange: (value: ConfidenceLevel | 'all') => void;
  onChangeTypeChange: (value: ChangeType | 'all') => void;
  onStatusChange: (value: SuggestionStatus | 'all') => void;
  onClear: () => void;
  hasFilters: boolean;
}

export function InboxFilters({
  search,
  confidence,
  changeType,
  status,
  onSearchChange,
  onConfidenceChange,
  onChangeTypeChange,
  onStatusChange,
  onClear,
  hasFilters
}: InboxFiltersProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </span>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="search" className="text-xs">Search</Label>
          <Input
            id="search"
            placeholder="Initiative or suggestion..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Confidence</Label>
          <Select value={confidence} onValueChange={onConfidenceChange}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Change Type</Label>
          <Select value={changeType} onValueChange={onChangeTypeChange}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="progress_update">Progress Update</SelectItem>
              <SelectItem value="timeline_change">Timeline Change</SelectItem>
              <SelectItem value="new_idea">New Idea</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="applied">Applied</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
