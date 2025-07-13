-- Storage Policies for user-uploads bucket
-- This file contains the necessary policies for profile picture uploads

-- Policy for INSERT (upload) - Users can only upload to their own folder
CREATE POLICY "Users can upload their own profile pictures" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'user-uploads' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy for SELECT (view) - Profile pictures are publicly viewable
CREATE POLICY "Profile pictures are publicly viewable" ON storage.objects
FOR SELECT USING (
  bucket_id = 'user-uploads'
);

-- Policy for DELETE - Users can only delete their own profile pictures
CREATE POLICY "Users can delete their own profile pictures" ON storage.objects
FOR DELETE USING (
  bucket_id = 'user-uploads' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy for UPDATE - Users can only update their own profile pictures
CREATE POLICY "Users can update their own profile pictures" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'user-uploads' AND 
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Make sure the bucket is public for profile pictures
-- This allows the profile pictures to be accessed via public URLs
SELECT 'Storage policies for user-uploads bucket created successfully' as status; 