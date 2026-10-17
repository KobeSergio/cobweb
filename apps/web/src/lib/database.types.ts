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
      airdrop_recipients: {
        Row: {
          block: number
          block_time: string
          collection_id: string
          first_token_id: number
          recipient: string
          tokens: number
          tx_hash: string
        }
        Insert: {
          block: number
          block_time: string
          collection_id: string
          first_token_id: number
          recipient: string
          tokens: number
          tx_hash: string
        }
        Update: {
          block?: number
          block_time?: string
          collection_id?: string
          first_token_id?: number
          recipient?: string
          tokens?: number
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'airdrop_recipients_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'airdrop_recipients_tx_hash_fkey'
            columns: ['tx_hash']
            isOneToOne: false
            referencedRelation: 'airdrops'
            referencedColumns: ['tx_hash']
          },
        ]
      }
      airdrops: {
        Row: {
          block: number
          block_time: string | null
          collection_id: string
          confirmed_at: string
          fee_paid_wei: number
          first_token_id: number
          kind: string
          last_token_id: number
          recipients: number
          sent_by: string | null
          tokens: number
          tx_hash: string
        }
        Insert: {
          block: number
          block_time?: string | null
          collection_id: string
          confirmed_at?: string
          fee_paid_wei: number
          first_token_id: number
          kind: string
          last_token_id: number
          recipients: number
          sent_by?: string | null
          tokens: number
          tx_hash: string
        }
        Update: {
          block?: number
          block_time?: string | null
          collection_id?: string
          confirmed_at?: string
          fee_paid_wei?: number
          first_token_id?: number
          kind?: string
          last_token_id?: number
          recipients?: number
          sent_by?: string | null
          tokens?: number
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'airdrops_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
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
          art_sources_deleted_at: string | null
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
          art_sources_deleted_at?: string | null
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
          art_sources_deleted_at?: string | null
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
      deployments: {
        Row: {
          airdrop_fee_per_token_wei: number
          args: Json
          base_uri: string
          chain_id: number
          code_hash: string
          collection_id: string
          contract_address: string
          created_at: string
          deployed_at: string
          deployer: string
          factory: string
          mint_fee_bps: number
          mint_fee_flat_wei: number
          mint_on_behalf: boolean
          payout_address: string
          public_max_per_wallet: number
          royalty_bps: number
          royalty_receiver: string
          salt: string
          state_block: number | null
          state_read_at: string | null
          transfer_validator: string | null
          tx_hash: string
        }
        Insert: {
          airdrop_fee_per_token_wei: number
          args: Json
          base_uri: string
          chain_id: number
          code_hash: string
          collection_id: string
          contract_address: string
          created_at?: string
          deployed_at?: string
          deployer: string
          factory: string
          mint_fee_bps: number
          mint_fee_flat_wei: number
          mint_on_behalf?: boolean
          payout_address: string
          public_max_per_wallet: number
          royalty_bps: number
          royalty_receiver: string
          salt: string
          state_block?: number | null
          state_read_at?: string | null
          transfer_validator?: string | null
          tx_hash: string
        }
        Update: {
          airdrop_fee_per_token_wei?: number
          args?: Json
          base_uri?: string
          chain_id?: number
          code_hash?: string
          collection_id?: string
          contract_address?: string
          created_at?: string
          deployed_at?: string
          deployer?: string
          factory?: string
          mint_fee_bps?: number
          mint_fee_flat_wei?: number
          mint_on_behalf?: boolean
          payout_address?: string
          public_max_per_wallet?: number
          royalty_bps?: number
          royalty_receiver?: string
          salt?: string
          state_block?: number | null
          state_read_at?: string | null
          transfer_validator?: string | null
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'deployments_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: true
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      indexer_cursors: {
        Row: {
          chain_id: number
          collection_id: string
          contract: string
          from_block: number
          holders: number
          indexed_block: number
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          chain_id: number
          collection_id: string
          contract: string
          from_block: number
          holders?: number
          indexed_block: number
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          chain_id?: number
          collection_id?: string
          contract?: string
          from_block?: number
          holders?: number
          indexed_block?: number
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'indexer_cursors_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: true
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
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
          description: string
          id: string
          max_supply: number
          name: string
          onchain_id: number
          position: number | null
          price_wei: number
          start_at: string | null
          updated_at: string
          visible: boolean
        }
        Insert: {
          collection_id: string
          created_at?: string
          description?: string
          id?: string
          max_supply?: number
          name: string
          onchain_id: number
          position?: number | null
          price_wei?: number
          start_at?: string | null
          updated_at?: string
          visible?: boolean
        }
        Update: {
          collection_id?: string
          created_at?: string
          description?: string
          id?: string
          max_supply?: number
          name?: string
          onchain_id?: number
          position?: number | null
          price_wei?: number
          start_at?: string | null
          updated_at?: string
          visible?: boolean
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
      mint_pages: {
        Row: {
          about_banner_key: string | null
          avatar_key: string | null
          banner_key: string | null
          collection_id: string
          description: string
          discord_url: string | null
          featured_token_ids: number[]
          published: boolean
          published_at: string | null
          sections: Json
          telegram_url: string | null
          updated_at: string
          website_url: string | null
          x_url: string | null
        }
        Insert: {
          about_banner_key?: string | null
          avatar_key?: string | null
          banner_key?: string | null
          collection_id: string
          description?: string
          discord_url?: string | null
          featured_token_ids?: number[]
          published?: boolean
          published_at?: string | null
          sections?: Json
          telegram_url?: string | null
          updated_at?: string
          website_url?: string | null
          x_url?: string | null
        }
        Update: {
          about_banner_key?: string | null
          avatar_key?: string | null
          banner_key?: string | null
          collection_id?: string
          description?: string
          discord_url?: string | null
          featured_token_ids?: number[]
          published?: boolean
          published_at?: string | null
          sections?: Json
          telegram_url?: string | null
          updated_at?: string
          website_url?: string | null
          x_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mint_pages_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: true
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      mints: {
        Row: {
          amount: number
          block: number
          block_time: string
          collection_id: string
          first_token_id: number
          group_id: number
          log_index: number
          recipient: string
          tx_hash: string
          vault: string | null
        }
        Insert: {
          amount: number
          block: number
          block_time: string
          collection_id: string
          first_token_id: number
          group_id: number
          log_index: number
          recipient: string
          tx_hash: string
          vault?: string | null
        }
        Update: {
          amount?: number
          block?: number
          block_time?: string
          collection_id?: string
          first_token_id?: number
          group_id?: number
          log_index?: number
          recipient?: string
          tx_hash?: string
          vault?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mints_collection_id_fkey'
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
          draft_cap: number
          id: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          draft_cap?: number
          id: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          draft_cap?: number
          id?: string
          wallet_address?: string
        }
        Relationships: []
      }
      render_batches: {
        Row: {
          attempts: number
          error: string | null
          error_code: string | null
          finished_at: string | null
          first_token_id: number
          images_cid: string | null
          images_size: number | null
          index: number
          job_id: string
          last_token_id: number
          started_at: string | null
          state: Database['public']['Enums']['batch_state']
          updated_at: string
        }
        Insert: {
          attempts?: number
          error?: string | null
          error_code?: string | null
          finished_at?: string | null
          first_token_id: number
          images_cid?: string | null
          images_size?: number | null
          index: number
          job_id: string
          last_token_id: number
          started_at?: string | null
          state?: Database['public']['Enums']['batch_state']
          updated_at?: string
        }
        Update: {
          attempts?: number
          error?: string | null
          error_code?: string | null
          finished_at?: string | null
          first_token_id?: number
          images_cid?: string | null
          images_size?: number | null
          index?: number
          job_id?: string
          last_token_id?: number
          started_at?: string | null
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
          base_uri: string | null
          batch_size: number
          batches_done: number
          batches_total: number
          collage_key: string | null
          collection_id: string
          created_at: string
          credit_job_id: string | null
          error: string | null
          error_code: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_image_cid: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_factory: string | null
          quote_payer: string | null
          quote_total_wei: number
          retries: number
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
          base_uri?: string | null
          batch_size?: number
          batches_done?: number
          batches_total?: number
          collage_key?: string | null
          collection_id: string
          created_at?: string
          credit_job_id?: string | null
          error?: string | null
          error_code?: string | null
          fee_per_token_wei: number
          finished_at?: string | null
          id?: string
          kind: Database['public']['Enums']['render_kind']
          metadata_cid?: string | null
          onchain_job_id?: string | null
          paid_amount_wei?: number | null
          paid_at?: string | null
          payment_tx_hash?: string | null
          placeholder_image_cid?: string | null
          placeholder_upload_id?: string | null
          quote_chain_id?: number | null
          quote_expires_at?: string | null
          quote_factory?: string | null
          quote_payer?: string | null
          quote_total_wei: number
          retries?: number
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
          base_uri?: string | null
          batch_size?: number
          batches_done?: number
          batches_total?: number
          collage_key?: string | null
          collection_id?: string
          created_at?: string
          credit_job_id?: string | null
          error?: string | null
          error_code?: string | null
          fee_per_token_wei?: number
          finished_at?: string | null
          id?: string
          kind?: Database['public']['Enums']['render_kind']
          metadata_cid?: string | null
          onchain_job_id?: string | null
          paid_amount_wei?: number | null
          paid_at?: string | null
          payment_tx_hash?: string | null
          placeholder_image_cid?: string | null
          placeholder_upload_id?: string | null
          quote_chain_id?: number | null
          quote_expires_at?: string | null
          quote_factory?: string | null
          quote_payer?: string | null
          quote_total_wei?: number
          retries?: number
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
            foreignKeyName: 'render_jobs_credit_job_id_fkey'
            columns: ['credit_job_id']
            isOneToOne: false
            referencedRelation: 'render_jobs'
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
      token_owners: {
        Row: {
          block: number
          collection_id: string
          log_index: number
          owner: string
          token_id: number
        }
        Insert: {
          block: number
          collection_id: string
          log_index: number
          owner: string
          token_id: number
        }
        Update: {
          block?: number
          collection_id?: string
          log_index?: number
          owner?: string
          token_id?: number
        }
        Relationships: [
          {
            foreignKeyName: 'token_owners_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
      token_ranks: {
        Row: {
          created_at: string
          job_id: string
          ranks: number[]
        }
        Insert: {
          created_at?: string
          job_id: string
          ranks: number[]
        }
        Update: {
          created_at?: string
          job_id?: string
          ranks?: number[]
        }
        Relationships: [
          {
            foreignKeyName: 'token_ranks_job_id_fkey'
            columns: ['job_id']
            isOneToOne: true
            referencedRelation: 'render_jobs'
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
          written_at: string | null
          written_quota: number | null
          written_tx: string | null
        }
        Insert: {
          collection_id: string
          created_at?: string
          mint_group_id: string
          quota: number
          wallet_address: string
          written_at?: string | null
          written_quota?: number | null
          written_tx?: string | null
        }
        Update: {
          collection_id?: string
          created_at?: string
          mint_group_id?: string
          quota?: number
          wallet_address?: string
          written_at?: string | null
          written_quota?: number | null
          written_tx?: string | null
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
      withdrawals: {
        Row: {
          amount_wei: number
          block: number
          collection_id: string
          confirmed_at: string
          payout_address: string
          tx_hash: string
        }
        Insert: {
          amount_wei: number
          block: number
          collection_id: string
          confirmed_at?: string
          payout_address: string
          tx_hash: string
        }
        Update: {
          amount_wei?: number
          block?: number
          collection_id?: string
          confirmed_at?: string
          payout_address?: string
          tx_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: 'withdrawals_collection_id_fkey'
            columns: ['collection_id']
            isOneToOne: false
            referencedRelation: 'collections'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      airdrop_record: {
        Args: {
          p_block: number
          p_collection_id: string
          p_fee_paid_wei: number
          p_first_token_id: number
          p_kind: string
          p_last_token_id: number
          p_owner: string
          p_recipients: number
          p_sent_by: string
          p_tokens: number
          p_tx: string
        }
        Returns: boolean
      }
      art_batch_done: {
        Args: {
          p_images_cid: string
          p_images_size: number
          p_index: number
          p_job_id: string
        }
        Returns: {
          batches_done: number
          last: boolean
        }[]
      }
      art_batch_failed: {
        Args: {
          p_code: string
          p_final: boolean
          p_index: number
          p_job_id: string
          p_message: string
          p_retries?: number
        }
        Returns: {
          allow_duplicates: boolean
          base_uri: string | null
          batch_size: number
          batches_done: number
          batches_total: number
          collage_key: string | null
          collection_id: string
          created_at: string
          credit_job_id: string | null
          error: string | null
          error_code: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_image_cid: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_factory: string | null
          quote_payer: string | null
          quote_total_wei: number
          retries: number
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
      art_batch_start: {
        Args: { p_index: number; p_job_id: string }
        Returns: {
          attempts: number
          error: string | null
          error_code: string | null
          finished_at: string | null
          first_token_id: number
          images_cid: string | null
          images_size: number | null
          index: number
          job_id: string
          last_token_id: number
          started_at: string | null
          state: Database['public']['Enums']['batch_state']
          updated_at: string
        }
        SetofOptions: {
          from: '*'
          to: 'render_batches'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      art_claim_render: {
        Args: { p_job_id: string }
        Returns: {
          allow_duplicates: boolean
          base_uri: string | null
          batch_size: number
          batches_done: number
          batches_total: number
          collage_key: string | null
          collection_id: string
          created_at: string
          credit_job_id: string | null
          error: string | null
          error_code: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_image_cid: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_factory: string | null
          quote_payer: string | null
          quote_total_wei: number
          retries: number
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
          p_factory?: string
          p_fee_per_token_wei: number
          p_kind: string
          p_owner: string
          p_payer: string
          p_token_list: Json
          p_token_list_hash: string
        }
        Returns: {
          allow_duplicates: boolean
          base_uri: string | null
          batch_size: number
          batches_done: number
          batches_total: number
          collage_key: string | null
          collection_id: string
          created_at: string
          credit_job_id: string | null
          error: string | null
          error_code: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_image_cid: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_factory: string | null
          quote_payer: string | null
          quote_total_wei: number
          retries: number
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
          base_uri: string | null
          batch_size: number
          batches_done: number
          batches_total: number
          collage_key: string | null
          collection_id: string
          created_at: string
          credit_job_id: string | null
          error: string | null
          error_code: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_image_cid: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_factory: string | null
          quote_payer: string | null
          quote_total_wei: number
          retries: number
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
          base_uri: string | null
          batch_size: number
          batches_done: number
          batches_total: number
          collage_key: string | null
          collection_id: string
          created_at: string
          credit_job_id: string | null
          error: string | null
          error_code: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_image_cid: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_factory: string | null
          quote_payer: string | null
          quote_total_wei: number
          retries: number
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
      art_render_credit: { Args: { p_collection_id: string; p_token_count: number }; Returns: string }
      art_render_finish: {
        Args: {
          p_base_uri: string
          p_collage_key?: string
          p_job_id: string
          p_metadata_cid: string
          p_placeholder_image_cid?: string
        }
        Returns: {
          allow_duplicates: boolean
          base_uri: string | null
          batch_size: number
          batches_done: number
          batches_total: number
          collage_key: string | null
          collection_id: string
          created_at: string
          credit_job_id: string | null
          error: string | null
          error_code: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_image_cid: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_factory: string | null
          quote_payer: string | null
          quote_total_wei: number
          retries: number
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
      art_render_retry: {
        Args: { p_collection_id: string }
        Returns: {
          allow_duplicates: boolean
          base_uri: string | null
          batch_size: number
          batches_done: number
          batches_total: number
          collage_key: string | null
          collection_id: string
          created_at: string
          credit_job_id: string | null
          error: string | null
          error_code: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_image_cid: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_factory: string | null
          quote_payer: string | null
          quote_total_wei: number
          retries: number
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
          base_uri: string | null
          batch_size: number
          batches_done: number
          batches_total: number
          collage_key: string | null
          collection_id: string
          created_at: string
          credit_job_id: string | null
          error: string | null
          error_code: string | null
          fee_per_token_wei: number
          finished_at: string | null
          id: string
          kind: Database['public']['Enums']['render_kind']
          metadata_cid: string | null
          onchain_job_id: string | null
          paid_amount_wei: number | null
          paid_at: string | null
          payment_tx_hash: string | null
          placeholder_image_cid: string | null
          placeholder_upload_id: string | null
          quote_chain_id: number | null
          quote_expires_at: string | null
          quote_factory: string | null
          quote_payer: string | null
          quote_total_wei: number
          retries: number
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
      collection_placeholder_ready: {
        Args: { p_collection_id: string }
        Returns: boolean
      }
      collection_record_deploy: {
        Args: {
          p_airdrop_fee_per_token_wei: number
          p_args: Json
          p_base_uri: string
          p_chain_id: number
          p_code_hash: string
          p_collection_id: string
          p_contract_address: string
          p_deployer: string
          p_factory: string
          p_groups: Json
          p_mint_fee_bps: number
          p_mint_fee_flat_wei: number
          p_owner: string
          p_payout_address: string
          p_public_max_per_wallet: number
          p_royalty_bps: number
          p_royalty_receiver: string
          p_salt: string
          p_tx_hash: string
        }
        Returns: {
          airdrop_fee_per_token_wei: number
          args: Json
          base_uri: string
          chain_id: number
          code_hash: string
          collection_id: string
          contract_address: string
          created_at: string
          deployed_at: string
          deployer: string
          factory: string
          mint_fee_bps: number
          mint_fee_flat_wei: number
          mint_on_behalf: boolean
          payout_address: string
          public_max_per_wallet: number
          royalty_bps: number
          royalty_receiver: string
          salt: string
          state_block: number | null
          state_read_at: string | null
          transfer_validator: string | null
          tx_hash: string
        }
        SetofOptions: {
          from: '*'
          to: 'deployments'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      collection_sources_deleted: {
        Args: { p_collection_id: string }
        Returns: boolean
      }
      collections_sources_due: { Args: { p_limit: number }; Returns: Json }
      indexer_record: {
        Args: {
          p_chain_id: number
          p_collections: string[]
          p_from_block: number
          p_records: Json
          p_synced_at: string
          p_to_block: number
        }
        Returns: Json
      }
      indexer_start: {
        Args: { p_collection_id: string; p_from_block: number }
        Returns: Json
      }
      indexer_summaries: {
        Args: { p_chain_id: number }
        Returns: Json
      }
      indexer_targets: {
        Args: { p_chain_id: number }
        Returns: Json
      }
      mint_group_move: {
        Args: { p_collection_id: string; p_onchain_id: number; p_up: boolean }
        Returns: undefined
      }
      mint_group_record: {
        Args: {
          p_collection_id: string
          p_description: string
          p_name: string
          p_onchain_id: number
          p_owner: string
          p_visible: boolean
        }
        Returns: {
          collection_id: string
          created_at: string
          description: string
          id: string
          max_supply: number
          name: string
          onchain_id: number
          position: number | null
          price_wei: number
          start_at: string | null
          updated_at: string
          visible: boolean
        }
        SetofOptions: {
          from: '*'
          to: 'mint_groups'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mint_groups_refresh: {
        Args: {
          p_block: number
          p_block_time: string
          p_collection_id: string
          p_groups: Json
          p_owner: string
          p_public_max_per_wallet: number
        }
        Returns: boolean
      }
      mint_page: {
        Args: { p_slug: string }
        Returns: Json
      }
      mint_page_preview: {
        Args: { p_slug: string }
        Returns: Json
      }
      mint_page_tiers: {
        Args: { p_base_uri: string; p_ids: number[]; p_slug: string }
        Returns: Json
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
      settings_refresh: {
        Args: {
          p_block: number
          p_block_time: string
          p_collection_id: string
          p_owner: string
          p_settings: Json
        }
        Returns: boolean
      }
      swap_token_ids_for_check: {
        Args: { p_a: number; p_b: number; p_collection_id: string }
        Returns: undefined
      }
      token_ranks_record: {
        Args: {
          p_collection_id: string
          p_job_id: string
          p_owner: string
          p_ranks: number[]
        }
        Returns: boolean
      }
      whitelist_chunk_record: {
        Args: {
          p_collection_id: string
          p_onchain_id: number
          p_owner: string
          p_rows: Json
          p_tx: string
        }
        Returns: number
      }
      whitelist_entries_add: {
        Args: { p_collection_id: string; p_onchain_id: number; p_rows: Json }
        Returns: {
          added: number
          updated: number
        }[]
      }
      withdrawal_record: {
        Args: {
          p_amount_wei: number
          p_block: number
          p_collection_id: string
          p_owner: string
          p_payout_address: string
          p_tx: string
        }
        Returns: boolean
      }
    }
    Enums: {
      batch_state: 'queued' | 'running' | 'done' | 'failed'
      collection_status: 'draft' | 'art_locked' | 'rendering' | 'rendered' | 'deployed'
      media_type: 'image' | 'gif' | 'video'
      project_type: 'generative' | 'one_of_one' | 'single_asset'
      render_kind: 'real' | 'placeholder'
      render_state:
        'locked' | 'payment_due' | 'paid' | 'waived' | 'rendering' | 'finalizing' | 'done' | 'failed'
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
      render_state: ['locked', 'payment_due', 'paid', 'waived', 'rendering', 'finalizing', 'done', 'failed'],
      rule_kind: ['doesnt_mix_with', 'always_pairs_with', 'must_pair_with'],
      upload_kind: ['layer_image', 'asset', 'placeholder', 'thumbnail'],
    },
  },
} as const
