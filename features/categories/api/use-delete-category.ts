import { toast } from "sonner";
import { InferResponseType } from "hono";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { client } from "@/lib/hono";
import { readErrorMessage } from "@/lib/api-error";

type ResponseType = InferResponseType<typeof client.api.categories[":id"]["$delete"]>;

export const useDeleteCategory = (id?: string) => {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    ResponseType,
    Error
  >({
    mutationFn: async () => {
      if (!id) {
        throw new Error("No category selected");
      }

      const response = await client.api.categories[":id"]["$delete"]({ 
        param: { id },
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to delete category"));
      }

      return await response.json();
    },
    onSuccess: () => {
      toast.success("Category deleted");
      queryClient.invalidateQueries({ queryKey: ["category", { id }] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  return mutation;
};
