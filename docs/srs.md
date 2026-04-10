# Online Market SRS

---

## 1. Authentication (AUTH)

### 1.1 Login

* **Status:** Completed

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* Users enter phone and password
* System validates:

  * Fields are not empty
  * Phone format is valid
  * Credentials are correct
* System displays error messages if validation fails

---

### 1.2 Registration

* **Status:** Completed

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* Users provide:

  * Name
  * SSN
  * Phone
  * Password
* System sends OTP
* User verifies OTP
* System creates account

---

### 1.3 Forget Password

* **Status:** Partial
* **Status Note:** OTP and reset flow exist, but no confirm-password matching field is exposed in the API contract.

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* System sends validation
* User verifies account
* System checks user existence
* User resets password:

  * Enter new password
  * Confirm password
* System validates:

  * Password strength
  * Password match
* Redirect back to login

---

## 2. Profile 

### 2.1 Show User Details

* **Status:** Partial
* **Status Note:** User details and rate are returned, but image is exposed as `avatar_file_id` rather than a direct image URL in the same response.

* **Actor:** System
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* Display:

  * ID
  * Name
  * Phone
  * Image
  * Rate


---

### 2.2 Edit User Details

* **Status:** Completed

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* Update:

  * Name
  * Profile image
  * Password

---

### 2.3 Change Password

* **Status:** Completed

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* Enter old password and new password
* System verifies old password
* System validates new password strength
* Show error messages if needed
* Confirm password reset success

---

### 2.4 Contact Info Management

* **Status:** Completed

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* Add / update / delete contact info
* Includes:

  * Phone
  * Email
  * Address

---

## 3. Chat

### 3.1 Send Messages

* **Status:** Completed

* **Actor:** Users
* **Priority:** Desirable
* **Stability:** Stable

**Description:**

* Real-time messaging between users

---

## 4. My Products

### 4.1 Add Product

* **Status:** Completed

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* Add product with:

  * Name
  * Description
  * Images
  * Category
  * Price
* Add delivery address

---

### 4.2 Update Product

* **Status:** Completed

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* Edit product details

---

### 4.3 Delete Product

* **Status:** Completed

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* Remove product

---

### 4.4 Get My Products

* **Status:** Completed

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* View owned products
* Includes:

  * Name
  * Description
  * Price
  * Delivery address
  * Created date/time
* Filters:

  * State
  * Date
  * Category
  * Price

---

### 4.5 Mark as Sold

* **Status:** Completed

* **Actor:** Users
* **Priority:** Desirable
* **Stability:** Stable

**Description:**

* Mark product as sold

---

### 4.6 Mark as Available

* **Status:** Completed

* **Actor:** Users
* **Priority:** Desirable
* **Stability:** Stable

**Description:**

* Mark product as available for sale

---

## 5. Search Products

### 5.1 Search

* **Status:** Completed

* **Actor:** Users
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* Search for products
* Filters:

  * Category
  * Price range
  * Date
  * Rate
  * Address
* Sorting:

  * Address
  * Price
  * User rate

---

## 6. Rate and Report

### 6.1 Rate Users

* **Status:** Completed

* **Actor:** Users
* **Priority:** Desirable
* **Stability:** Stable

**Description:**

* Users rate each other
* Includes:

  * Rating value
  * Comment

---

### 6.2 Report Users

* **Status:** Completed

* **Actor:** Users
* **Priority:** Desirable
* **Stability:** Stable

**Description:**

* Submit reports to admins
* Includes:

  * Reason

---

## 7. Admin Dashboard

### 7.1 User Management

* **Status:** Completed

* **Actor:** Admins
* **Priority:** Mandatory
* **Stability:** Stable

**Description:**

* View system users
* Ban or pause accounts

---

### 7.2 Warnings

* **Status:** Completed

* **Actor:** Admins
* **Priority:** Optional
* **Stability:** Stable

**Description:**

* Send warnings to users

---

### 7.3 Reports Management

* **Status:** Completed

* **Actor:** Admins
* **Priority:** Desirable
* **Stability:** Stable

**Description:**

* Review user reports
