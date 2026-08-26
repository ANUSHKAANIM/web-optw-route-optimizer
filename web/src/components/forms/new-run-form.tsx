"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { createRunSchema, type CreateRunRequest } from "@/lib/dto/run.dto";
import { apiClient } from "@/lib/api-client";

const DEFAULTS: CreateRunRequest = createRunSchema.parse({});

export function NewRunForm() {
  const router = useRouter();
  const [values, setValues] = useState<CreateRunRequest>(DEFAULTS);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mutation = useMutation({
    mutationFn: (request: CreateRunRequest) => apiClient.createRun(request),
    onSuccess: (view) => {
      toast.success("Run created", { description: `Instance with ${view.run.numNodes} nodes is ready.` });
      router.push(`/runs/${view.run.id}`);
    },
    onError: (error: Error) => {
      toast.error("Could not create run", { description: error.message });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = createRunSchema.safeParse(values);
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        errors[String(issue.path[0])] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    mutation.mutate(result.data);
  }

  function field(key: keyof CreateRunRequest) {
    return {
      value: values[key] as number | undefined,
      onChange: (v: number | undefined) =>
        setValues((prev) => ({ ...prev, [key]: v }) as CreateRunRequest),
      error: fieldErrors[key],
    };
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Configure a new route optimization</CardTitle>
          <CardDescription>
            Generates a fresh problem instance (node locations, rewards, and time windows) and
            starts an interactive routing session driven by the trained Pointer Network.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              id="numNodes"
              label="Number of nodes"
              description="Locations to potentially visit, including the depot."
              min={5}
              max={200}
              {...field("numNodes")}
            />
            <NumberField
              id="maxTime"
              label="Time budget (hours)"
              description="Total time available before you must be back at the depot."
              min={1}
              step={0.5}
              {...field("maxTime")}
            />
            <NumberField
              id="beamWidth"
              label="Beam width"
              description="How many candidate routes the recommender tracks at once."
              min={1}
              max={128}
              {...field("beamWidth")}
            />
            <NumberField
              id="rewardDecayMin"
              label="Minimum reward decay"
              description="Fraction of a node's reward still paid if visited right at the deadline (0-1)."
              min={0}
              max={1}
              step={0.05}
              {...field("rewardDecayMin")}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="enableForecastEvents">Cyclone-style forecast events</Label>
              <p className="text-sm text-muted-foreground">
                Rewards and evacuation deadlines shift on their own clock as a simulated hazard
                track updates, independent of your movement.
              </p>
            </div>
            <Switch
              id="enableForecastEvents"
              checked={values.enableForecastEvents}
              onCheckedChange={(checked) => setValues((prev) => ({ ...prev, enableForecastEvents: checked }))}
            />
          </div>

          {values.enableForecastEvents && (
            <div className="grid gap-4 rounded-md border bg-muted/40 p-4 sm:grid-cols-3">
              <NumberField
                id="hazardRadius"
                label="Hazard radius"
                min={0.05}
                step={0.05}
                {...field("hazardRadius")}
              />
              <NumberField
                id="forecastUpdateInterval"
                label="Update interval (h)"
                min={0.5}
                step={0.5}
                {...field("forecastUpdateInterval")}
              />
              <NumberField
                id="forecastNoise"
                label="Forecast noise"
                min={0}
                step={0.01}
                {...field("forecastNoise")}
              />
            </div>
          )}

          <Separator />

          <NumberField
            id="seed"
            label="Random seed (optional)"
            description="Leave blank for a random instance each time."
            allowEmpty
            {...field("seed")}
          />
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={mutation.isPending} className="gap-2">
            {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Start optimization
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function NumberField({
  id,
  label,
  description,
  value,
  onChange,
  error,
  min,
  max,
  step = 1,
  allowEmpty = false,
}: {
  id: string;
  label: string;
  description?: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  error?: string;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value ?? ""}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" && allowEmpty) {
            onChange(undefined);
            return;
          }
          const parsed = Number(raw);
          onChange(Number.isNaN(parsed) ? undefined : parsed);
        }}
      />
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
