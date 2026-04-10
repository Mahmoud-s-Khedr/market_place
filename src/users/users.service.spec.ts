import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const databaseService = {
    query: jest.fn(),
  };

  const fileReadUrlService = {
    buildReadUrl: jest.fn().mockReturnValue('https://res.cloudinary.com/demo/image/upload/users/1/avatar.jpg'),
  };

  const service = new UsersService(databaseService as any, fileReadUrlService as any);

  const user = { sub: 1, phone: '+201000000001', isAdmin: false };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getMe', () => {
    it('returns user profile with resolved avatar_url', async () => {
      databaseService.query.mockResolvedValue({
        rowCount: 1,
        rows: [{
          id: 1,
          name: 'Alice',
          phone: '+201000000001',
          status: 'active',
          rate: '4.50',
          avatar_object_key: 'users/1/avatar.jpg',
          avatar_mime_type: 'image/jpeg',
        }],
      });

      const result = await service.getMe(user);

      expect(result).toMatchObject({
        success: true,
        user: expect.objectContaining({
          avatar_url: 'https://res.cloudinary.com/demo/image/upload/users/1/avatar.jpg',
        }),
      });
      expect((result.user as Record<string, unknown>)).not.toHaveProperty('avatar_object_key');
    });

    it('returns null avatar_url when no avatar set', async () => {
      databaseService.query.mockResolvedValue({
        rowCount: 1,
        rows: [{ id: 1, name: 'Bob', phone: '+201000000002', status: 'active', rate: '0.00', avatar_object_key: null, avatar_mime_type: null }],
      });

      const result = await service.getMe(user);

      expect((result.user as Record<string, unknown>).avatar_url).toBeNull();
    });

    it('throws NotFoundException when user not found', async () => {
      databaseService.query.mockResolvedValue({ rowCount: 0, rows: [] });

      await expect(service.getMe(user)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateMe', () => {
    it('throws BadRequestException when nothing to update', async () => {
      await expect(service.updateMe(user, {})).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when avatar file does not exist', async () => {
      databaseService.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.updateMe(user, { avatarFileId: 99 })).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when avatar file belongs to another user', async () => {
      databaseService.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 99, uploader_user_id: 42, purpose: 'avatar', status: 'uploaded' }],
      });

      await expect(service.updateMe(user, { avatarFileId: 99 })).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when avatar uploader is null', async () => {
      databaseService.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 99, uploader_user_id: null, purpose: 'avatar', status: 'uploaded' }],
      });

      await expect(service.updateMe(user, { avatarFileId: 99 })).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when file is not uploaded avatar', async () => {
      databaseService.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 99, uploader_user_id: 1, purpose: 'product_image', status: 'pending' }],
      });

      await expect(service.updateMe(user, { avatarFileId: 99 })).rejects.toThrow(BadRequestException);
    });
  });

  describe('changePassword', () => {
    it('throws NotFoundException when user not found', async () => {
      databaseService.query.mockResolvedValue({ rowCount: 0, rows: [] });

      await expect(
        service.changePassword(user, { oldPassword: 'old', newPassword: 'newPassword1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when old password is wrong', async () => {
      // Use a real bcrypt hash for 'correctpassword'
      databaseService.query.mockResolvedValue({
        rowCount: 1,
        rows: [{ password_hash: '$2b$12$UOnNZ9OeWkCpW0fQ8LQXbu0Y8i2JYtrrSIRB2x00D1B5wYAkqM8Fi' }],
      });

      await expect(
        service.changePassword(user, { oldPassword: 'wrongpassword', newPassword: 'newPassword1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('contact CRUD', () => {
    it('listContacts returns contacts array', async () => {
      databaseService.query.mockResolvedValue({ rowCount: 2, rows: [{ id: 1 }, { id: 2 }] });

      const result = await service.listContacts(user);

      expect(result).toMatchObject({ success: true, contacts: expect.any(Array) });
    });

    it('createContact returns new contact', async () => {
      databaseService.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // UPDATE is_primary (if isPrimary=true)
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 10, type: 'phone', value: '123', city: null, is_primary: false }] });

      const result = await service.createContact(user, { type: 'phone', value: '123', isPrimary: true });

      expect(result).toMatchObject({ success: true, contact: expect.objectContaining({ id: 10 }) });
    });

    it('updateContact throws NotFoundException when contact not found', async () => {
      databaseService.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.updateContact(user, 999, { value: 'new' })).rejects.toThrow(NotFoundException);
    });

    it('deleteContact throws NotFoundException when contact not found', async () => {
      databaseService.query.mockResolvedValue({ rowCount: 0, rows: [] });

      await expect(service.deleteContact(user, 999)).rejects.toThrow(NotFoundException);
    });

    it('deleteContact returns success when contact deleted', async () => {
      databaseService.query.mockResolvedValue({ rowCount: 1, rows: [] });

      const result = await service.deleteContact(user, 5);

      expect(result).toMatchObject({ success: true });
    });
  });
});
