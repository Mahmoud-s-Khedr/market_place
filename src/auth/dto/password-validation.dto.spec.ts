import { validate } from 'class-validator';
import { ChangePasswordDto } from '../../users/dto/change-password.dto';
import { LoginDto } from './login.dto';
import { RequestRegistrationOtpDto } from './request-registration-otp.dto';
import { ResetPasswordDto } from './reset-password.dto';

describe('password DTO validation', () => {
  const passwords = ['a', '密码', '😀', ''];

  it.each(passwords)('accepts any string during registration: %p', async (password) => {
    const dto = Object.assign(new RequestRegistrationOtpDto(), {
      name: 'Test User',
      phone: '+201000000000',
      password,
    });

    expect(await validate(dto)).toEqual([]);
  });

  it.each(passwords)('accepts any string during login: %p', async (password) => {
    const dto = Object.assign(new LoginDto(), {
      phone: '+201000000000',
      password,
    });

    expect(await validate(dto)).toEqual([]);
  });

  it.each(passwords)('accepts any string for a password reset: %p', async (password) => {
    const dto = Object.assign(new ResetPasswordDto(), {
      phone: '+201000000000',
      otp: '000000',
      newPassword: password,
      confirmPassword: password,
    });

    expect(await validate(dto)).toEqual([]);
  });

  it.each(passwords)('accepts any string for a password change: %p', async (password) => {
    const dto = Object.assign(new ChangePasswordDto(), {
      oldPassword: password,
      newPassword: password,
    });

    expect(await validate(dto)).toEqual([]);
  });
});
