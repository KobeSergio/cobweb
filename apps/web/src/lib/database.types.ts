export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      art_collections: {
        Row: {
          collection_id: string
          created_at: string
          id: string
          name: string
          position: number
          size: number
          updated_at: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          id?: string
          name: string
          position: number
          size?: number
          updated_at?: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          size?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'art_collections_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      at_least_one: {
        Row: {
          art_collection_id: string
          collection_id: string
          created_at: string
          id: string
          trait_ids: string[]
        }
        Insert: {
          art_collection_id: string
          collection_id: string
          created_at?: string
          id?: string
          trait_ids: string[]
        }
        Update: {
          art_collection_id?: string
          collection_id?: string
          created_at?: string
          id?: string
          trait_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: 'at_least_one_art_collection_id_fkey'
            columns: ['art_collection_id']
            isOneToOne: false
            referencedRelation: 'art_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'at_least_one_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      collections: {
        Row: {
          art_deferred: boolean
          art_locked_at: string | null
          canvas_height: number | null
          canvas_width: number | null
          chain_id: number | null
          contract_address: string | null
          created_at: string
          description: string
          generation_seed: number | null
          id: string
          max_supply: number | null
          name: string
          owner_id: string
          project_type: Database['public']['Enums']['project_type']
          show_blank_traits: boolean
          slug: string | null
          slug_reserved_at: string | null
          status: Database['public']['Enums']['collection_status']
          symbol: string
          token_description: string
          token_name: string | null
          updated_at: string
        }
        Insert: {
          art_deferred?: boolean
          art_locked_at?: string | null
          canvas_height?: number | null
          canvas_width?: number | null
          chain_id?: number | null
          contract_address?: string | null
          created_at?: string
          description?: string
          generation_seed?: number | null
          id?: string
          max_supply?: number | null
          name: string
          owner_id?: string
          project_type: Database['public']['Enums']['project_type']
          show_blank_traits?: boolean
          slug?: string | null
          slug_reserved_at?: string | null
          status?: Database['public']['Enums']['collection_status']
          symbol: string
          token_description?: string
          token_name?: string | null
          updated_at?: string
        }
        Update: {
          art_deferred?: boolean
          art_locked_at?: string | null
          canvas_height?: number | null
          canvas_width?: number | null
          chain_id?: number | null
          contract_address?: string | null
          created_at?: string
          description?: string
          generation_seed?: number | null
          id?: string
          max_supply?: number | null
          name?: string
          owner_id?: string
          project_type?: Database['public']['Enums']['project_type']
          show_blank_traits?: boolean
          slug?: string | null
          slug_reserved_at?: string | null
          status?: Database['public']['Enums']['collection_status']
          symbol?: string
          token_description?: string
          token_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      layers: {
        Row: {
          art_collection_id: string
          bypass_dna: boolean
          collection_id: string
          created_at: string
          display_name: string | null
          id: string
          name: string
          position: number
          updated_at: string
        }
        Insert: {
          art_collection_id: string
          bypass_dna?: boolean
          collection_id: string
          created_at?: string
          display_name?: string | null
          id?: string
          name: string
          position: number
          updated_at?: string
        }
        Update: {
          art_collection_id?: string
          bypass_dna?: boolean
          collection_id?: string
          created_at?: string
          display_name?: string | null
          id?: string
          name?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'layers_art_collection_id_fkey'
            columns: ['art_collection_id']
            isOneToOne: false
            referencedRelation: 'art_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'layers_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      mint_groups: {
        Row: {
          collection_id: string
          created_at: string
          id: string
          max_supply: number
          name: string
          onchain_id: number
          price_wei: number
          start_at: string | null
          updated_at: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          id?: string
          max_supply?: number
          name: string
          onchain_id: number
          price_wei?: number
          start_at?: string | null
          updated_at?: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          id?: string
          max_supply?: number
          name?: string
          onchain_id?: number
          price_wei?: number
          start_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'mint_groups_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          id: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          id?: string
          wallet_address?: string
        }
        Relationships: []
      }
      render_batches: {
        Row: {
          attempts: number
          error: string | null
          first_token_id: number
          images_cid: string | null
          index: number
          job_id: string
          last_token_id: number
          state: Database['public']['Enums']['batch_state']
          updated_at: string
        }
        Insert: {
          attempts?: number
          error?: string | null
          first_token_id: number
          images_cid?: string | null
          index: number
          job_id: string
          last_token_id: number
          state?: Database['public']['Enums']['batch_state']
          updated_at?: string
        }
        Update: {
          attempts?: number
          error?: string | null
          first_token_id?: number
          images_cid?: string | null
          index?: number
          job_id?: string
          last_token_id?: number
          state?: Database['public']['Enums']['batch_state']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'render_batches_job_id_fkey'
            columns: ['job_id']
            isOneToOne: false
            referencedRelation: 'render_jobs'
            referencedColumns: ['id']
          },
        ]
      }
      render_jobs: {
        Row: {
          allow_duplicates: boolean
          batch_size: number
          batches_done: number
          batches_total: number
          collection_id: string
          created_at: string
          error: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          images_cid: string | null
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_payer: string | null
          quote_total_wei: number
          started_at: string | null
          state: Database['public']['Enums']['render_state']
          token_count: number
          token_list: Json | null
          token_list_hash: string | null
          updated_at: string
          waived_by: string | null
          waived_reason: string | null
        }
        Insert: {
          allow_duplicates?: boolean
          batch_size?: number
          batches_done?: number
          batches_total?: number
          collection_id: string
          created_at?: string
          error?: string | null
          fee_per_token_wei: number
          finished_at?: string | null
          id?: string
          images_cid?: string | null
          kind: Database['public']['Enums']['render_kind']
          metadata_cid?: string | null
          onchain_job_id?: string | null
          paid_amount_wei?: number | null
          paid_at?: string | null
          payment_tx_hash?: string | null
          placeholder_upload_id?: string | null
          quote_chain_id?: number | null
          quote_expires_at?: string | null
          quote_payer?: string | null
          quote_total_wei: number
          started_at?: string | null
          state?: Database['public']['Enums']['render_state']
          token_count: number
          token_list?: Json | null
          token_list_hash?: string | null
          updated_at?: string
          waived_by?: string | null
          waived_reason?: string | null
        }
        Update: {
          allow_duplicates?: boolean
          batch_size?: number
          batches_done?: number
          batches_total?: number
          collection_id?: string
          created_at?: string
          error?: string | null
          fee_per_token_wei?: number
          finished_at?: string | null
          id?: string
          images_cid?: string | null
          kind?: Database['public']['Enums']['render_kind']
          metadata_cid?: string | null
          onchain_job_id?: string | null
          paid_amount_wei?: number | null
          paid_at?: string | null
          payment_tx_hash?: string | null
          placeholder_upload_id?: string | null
          quote_chain_id?: number | null
          quote_expires_at?: string | null
          quote_payer?: string | null
          quote_total_wei?: number
          started_at?: string | null
          state?: Database['public']['Enums']['render_state']
          token_count?: number
          token_list?: Json | null
          token_list_hash?: string | null
          updated_at?: string
          waived_by?: string | null
          waived_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'render_jobs_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'render_jobs_placeholder_upload_id_fkey'
            columns: ['placeholder_upload_id']
            isOneToOne: false
            referencedRelation: 'uploads'
            referencedColumns: ['id']
          },
        ]
      }
      rules: {
        Row: {
          bidirectional: boolean
          collection_id: string
          created_at: string
          id: string
          kind: Database['public']['Enums']['rule_kind']
          related_trait_ids: string[]
          trait_id: string
          updated_at: string
        }
        Insert: {
          bidirectional: boolean
          collection_id: string
          created_at?: string
          id?: string
          kind: Database['public']['Enums']['rule_kind']
          related_trait_ids: string[]
          trait_id: string
          updated_at?: string
        }
        Update: {
          bidirectional?: boolean
          collection_id?: string
          created_at?: string
          id?: string
          kind?: Database['public']['Enums']['rule_kind']
          related_trait_ids?: string[]
          trait_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'rules_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rules_trait_id_fkey'
            columns: ['trait_id']
            isOneToOne: false
            referencedRelation: 'traits'
            referencedColumns: ['id']
          },
        ]
      }
      tokens: {
        Row: {
          art_collection_id: string
          collection_id: string
          description: string | null
          dna: string[]
          token_id: number
          updated_at: string
        }
        Insert: {
          art_collection_id: string
          collection_id: string
          description?: string | null
          dna: string[]
          token_id: number
          updated_at?: string
        }
        Update: {
          art_collection_id?: string
          collection_id?: string
          description?: string | null
          dna?: string[]
          token_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tokens_art_collection_id_fkey'
            columns: ['art_collection_id']
            isOneToOne: false
            referencedRelation: 'art_collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tokens_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      traits: {
        Row: {
          blank: boolean
          collection_id: string
          constant: number | null
          created_at: string
          id: string
          in_metadata: boolean
          layer_id: string
          name: string
          position: number
          updated_at: string
          upload_id: string | null
          weight: number
        }
        Insert: {
          blank?: boolean
          collection_id: string
          constant?: number | null
          created_at?: string
          id?: string
          in_metadata?: boolean
          layer_id: string
          name: string
          position: number
          updated_at?: string
          upload_id?: string | null
          weight: number
        }
        Update: {
          blank?: boolean
          collection_id?: string
          constant?: number | null
          created_at?: string
          id?: string
          in_metadata?: boolean
          layer_id?: string
          name?: string
          position?: number
          updated_at?: string
          upload_id?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: 'traits_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'traits_layer_id_fkey'
            columns: ['layer_id']
            isOneToOne: false
            referencedRelation: 'layers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'traits_upload_id_fkey'
            columns: ['upload_id']
            isOneToOne: false
            referencedRelation: 'uploads'
            referencedColumns: ['id']
          },
        ]
      }
      uploads: {
        Row: {
          attributes: Json
          bytes: number
          collection_id: string
          content_hash: string
          created_at: string
          file_name: string
          height: number | null
          id: string
          kind: Database['public']['Enums']['upload_kind']
          media_type: Database['public']['Enums']['media_type']
          mime: string
          position: number | null
          quantity: number
          storage_key: string
          width: number | null
        }
        Insert: {
          attributes?: Json
          bytes: number
          collection_id: string
          content_hash: string
          created_at?: string
          file_name: string
          height?: number | null
          id?: string
          kind: Database['public']['Enums']['upload_kind']
          media_type: Database['public']['Enums']['media_type']
          mime: string
          position?: number | null
          quantity?: number
          storage_key: string
          width?: number | null
        }
        Update: {
          attributes?: Json
          bytes?: number
          collection_id?: string
          content_hash?: string
          created_at?: string
          file_name?: string
          height?: number | null
          id?: string
          kind?: Database['public']['Enums']['upload_kind']
          media_type?: Database['public']['Enums']['media_type']
          mime?: string
          position?: number | null
          quantity?: number
          storage_key?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'uploads_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      whitelist_entries: {
        Row: {
          collection_id: string
          created_at: string
          mint_group_id: string
          quota: number
          wallet_address: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          mint_group_id: string
          quota: number
          wallet_address: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          mint_group_id?: string
          quota?: number
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: 'whitelist_entries_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'whitelist_entries_mint_group_id_fkey'
            columns: ['mint_group_id']
            isOneToOne: false
            referencedRelation: 'mint_groups'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      art_delete_art_collection: {
        Args: { p_art_collection_id: string; p_collection_id: string }
        Returns: undefined
      }
      art_delete_layer: {
        Args: {
          p_clear_tokens: boolean
          p_collection_id: string
          p_layer_id: string
        }
        Returns: undefined
      }
      art_delete_tokens: {
        Args: { p_collection_id: string; p_ids: number[] }
        Returns: undefined
      }
      art_delete_trait: {
        Args: { p_collection_id: string; p_trait_id: string }
        Returns: undefined
      }
      art_import_layers: {
        Args: { p_collection_id: string; p_payload: Json }
        Returns: Json
      }
      art_lock: {
        Args: {
          p_allow_duplicates: boolean
          p_chain_id: number
          p_collection_id: string
          p_fee_per_token_wei: number
          p_kind: string
          p_owner: string
          p_payer: string
          p_token_list: Json
          p_token_list_hash: string
        }
        Returns: {
          allow_duplicates: boolean
          batch_size: number
          batches_done: number
          batches_total: number
          collection_id: string
          created_at: string
          error: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          images_cid: string | null
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_payer: string | null
          quote_total_wei: number
          started_at: string | null
          state: Database['public']['Enums']['render_state']
          token_count: number
          token_list: Json | null
          token_list_hash: string | null
          updated_at: string
          waived_by: string | null
          waived_reason: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'render_jobs'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      art_lock_placeholder: {
        Args: { p_collection_id: string; p_placeholder_upload_id: string }
        Returns: {
          allow_duplicates: boolean
          batch_size: number
          batches_done: number
          batches_total: number
          collection_id: string
          created_at: string
          error: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          images_cid: string | null
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_payer: string | null
          quote_total_wei: number
          started_at: string | null
          state: Database['public']['Enums']['render_state']
          token_count: number
          token_list: Json | null
          token_list_hash: string | null
          updated_at: string
          waived_by: string | null
          waived_reason: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'render_jobs'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      art_move_layer: {
        Args: {
          p_collection_id: string
          p_layer_id: string
          p_position: number
        }
        Returns: undefined
      }
      art_record_payment: {
        Args: {
          p_amount_wei: number
          p_collection_id: string
          p_job_id: string
          p_owner: string
          p_payer: string
          p_tx_hash: string
        }
        Returns: {
          allow_duplicates: boolean
          batch_size: number
          batches_done: number
          batches_total: number
          collection_id: string
          created_at: string
          error: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          images_cid: string | null
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_payer: string | null
          quote_total_wei: number
          started_at: string | null
          state: Database['public']['Enums']['render_state']
          token_count: number
          token_list: Json | null
          token_list_hash: string | null
          updated_at: string
          waived_by: string | null
          waived_reason: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'render_jobs'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      art_requote: {
        Args: {
          p_collection_id: string
          p_fee_per_token_wei: number
          p_owner: string
        }
        Returns: {
          allow_duplicates: boolean
          batch_size: number
          batches_done: number
          batches_total: number
          collection_id: string
          created_at: string
          error: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          images_cid: string | null
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_payer: string | null
          quote_total_wei: number
          started_at: string | null
          state: Database['public']['Enums']['render_state']
          token_count: number
          token_list: Json | null
          token_list_hash: string | null
          updated_at: string
          waived_by: string | null
          waived_reason: string | null
        }
        SetofOptions: {
          from: '*'
          to: 'render_jobs'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      art_save_tokens: {
        Args: { p_collection_id: string; p_seed: number; p_tokens: Json }
        Returns: undefined
      }
      art_set_asset_order: {
        Args: { p_collection_id: string; p_rows: Json }
        Returns: undefined
      }
      art_set_layer_weights: {
        Args: { p_collection_id: string; p_layer_id: string; p_rows: Json }
        Returns: undefined
      }
      art_start_over: { Args: { p_collection_id: string }; Returns: string[] }
      art_table_facts: {
        Args: never
        Returns: {
          anon_grants: number
          policies: number
          rls: boolean
          table_name: string
        }[]
      }
      art_unlock: { Args: { p_collection_id: string }; Returns: undefined }
      art_update_tokens: {
        Args: { p_collection_id: string; p_rows: Json }
        Returns: undefined
      }
      record_upload: {
        Args: {
          p_bytes: number
          p_collection_id: string
          p_content_hash: string
          p_file_name: string
          p_height: number
          p_kind: Database['public']['Enums']['upload_kind']
          p_media_type: Database['public']['Enums']['media_type']
          p_mime: string
          p_storage_key: string
          p_width: number
        }
        Returns: string
      }
      reserve_slug: {
        Args: { p_collection_id: string; p_slug: string }
        Returns: undefined
      }
      swap_token_ids_for_check: {
        Args: { p_a: number; p_b: number; p_collection_id: string }
        Returns: undefined
      }
    }
    Enums: {
      batch_state: 'queued' | 'running' | 'done' | 'failed'
      collection_status: 'draft' | 'art_locked' | 'rendering' | 'rendered' | 'deployed'
      media_type: 'image' | 'gif' | 'video'
      project_type: 'generative' | 'one_of_one' | 'single_asset'
      render_kind: 'real' | 'placeholder'
      render_state: 'locked' | 'payment_due' | 'paid' | 'waived' | 'rendering' | 'done' | 'failed'
      rule_kind: 'doesnt_mix_with' | 'always_pairs_with' | 'must_pair_with'
      upload_kind: 'layer_image' | 'asset' | 'placeholder' | 'thumbnail'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema['Tables'] & DefaultSchema['Views']) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      batch_state: ['queued', 'running', 'done', 'failed'],
      collection_status: ['draft', 'art_locked', 'rendering', 'rendered', 'deployed'],
      media_type: ['image', 'gif', 'video'],
      project_type: ['generative', 'one_of_one', 'single_asset'],
      render_kind: ['real', 'placeholder'],
      render_state: ['locked', 'payment_due', 'paid', 'waived', 'rendering', 'done', 'failed'],
      rule_kind: ['doesnt_mix_with', 'always_pairs_with', 'must_pair_with'],
      upload_kind: ['layer_image', 'asset', 'placeholder', 'thumbnail'],
    },
  },
} as const
